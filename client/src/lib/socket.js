import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const socket = io();
// Sessions live per room code ({code: {code, token, teamId, updatedAt}}) so a
// second tab opening another room can never clobber this one's seat. One
// global key meant every tab shared (and stole) a single session.
const SESSIONS_KEY = 'ipl-auction:sessions';
const LEGACY_KEY = 'ipl-auction:session';

function readSessions() {
  try {
    const sessions = JSON.parse(window.localStorage.getItem(SESSIONS_KEY));
    return sessions && typeof sessions === 'object' ? sessions : {};
  } catch {
    return {};
  }
}

function writeSessions(sessions) {
  try {
    window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    return;
  }
}

function migrateLegacySession() {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed?.code && parsed?.token) {
      writeSessions({ ...readSessions(), [parsed.code]: parsed });
    }
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    return;
  }
}

function readSession() {
  migrateLegacySession();
  const sessions = Object.values(readSessions())
    .filter((session) => session?.code && session?.token)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return sessions[0] ?? null;
}

export function useAuctionSocket() {
  const initialSession = useRef(readSession());
  const sessionRef = useRef(initialSession.current);
  const snapshotRef = useRef(null);
  const rejoinInFlight = useRef(false);
  const noticeId = useRef(0);

  const [snapshot, setSnapshot] = useState(null);
  const [connected, setConnected] = useState(socket.connected);
  const [restoring, setRestoring] = useState(Boolean(initialSession.current));
  const [timer, setTimer] = useState(null);
  const [notice, setNotice] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);

  const notify = useCallback((text, tone = 'info') => {
    noticeId.current += 1;
    setNotice({ id: noticeId.current, text, tone });
  }, []);

  const clearNotice = useCallback(() => setNotice(null), []);

  const request = useCallback(
    (event, payload) =>
      new Promise((resolve) => {
        let settled = false;
        const settle = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          socket.off('connect', emit);
          resolve(value);
        };
        const timeout = setTimeout(() => {
          settle({ ok: false, error: 'The server did not answer. Try again.' });
        }, 8000);
        const emit = () =>
          socket.emit(event, payload, (response) => {
            settle(response ?? { ok: false, error: 'No response from the server.' });
          });

        if (socket.connected) emit();
        else socket.once('connect', emit);
      }),
    [],
  );

  const applySession = useCallback((session) => {
    sessionRef.current = session;
    const sessions = readSessions();
    if (session) {
      sessions[session.code] = { ...session, updatedAt: Date.now() };
      writeSessions(sessions);
    } else if (sessionRef.current?.code || snapshotRef.current?.code) {
      const closedCode = sessionRef.current?.code ?? snapshotRef.current?.code;
      delete sessions[closedCode];
      writeSessions(sessions);
    }
  }, []);

  const handleSnapshot = useCallback((incoming) => {
    snapshotRef.current = incoming;
    setSnapshot(incoming);
    setRestoring(false);
  }, []);

  const rejoin = useCallback(async () => {
    if (rejoinInFlight.current) return;
    const session = sessionRef.current;
    if (!session) {
      setRestoring(false);
      return;
    }
    rejoinInFlight.current = true;
    try {
      const response = await request('room:rejoin', { code: session.code, token: session.token });
      if (response.ok) {
        applySession({ code: response.code, token: response.token, teamId: response.teamId });
        if (response.snapshot) setSnapshot(response.snapshot);
        setRestoring(false);
      } else {
        applySession(null);
        setSnapshot(null);
        setTimer(null);
        setRestoring(false);
        notify('That room is no longer available. Create a room or join with a fresh code.', 'error');
      }
    } finally {
      rejoinInFlight.current = false;
    }
  }, [applySession, notify, request]);

  useEffect(() => {
    function onConnect() {
      setConnected(true);
      if (sessionRef.current) rejoin();
      else setRestoring(false);
    }

    function onDisconnect() {
      setConnected(false);
    }

    function onConnectError() {
      setConnected(false);
    }

    function onTimer(value) {
      setTimer({ ...value, at: Date.now() });
    }

    function onClosed(payload) {
      applySession(null);
      setSnapshot(null);
      setTimer(null);
      setRestoring(false);
      notify(payload?.reason ?? 'This room closed.', 'error');
    }

    function onChatMessage(msg) {
      setChatMessages((prev) => [...prev, msg].slice(-200));
    }

    function onChatHistory(history) {
      if (Array.isArray(history)) {
        setChatMessages(history.slice(-200));
      }
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('room:snapshot', handleSnapshot);
    socket.on('auction:timer', onTimer);
    socket.on('room:closed', onClosed);
    socket.on('chat:message', onChatMessage);
    socket.on('chat:history', onChatHistory);

    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('room:snapshot', handleSnapshot);
      socket.off('auction:timer', onTimer);
      socket.off('room:closed', onClosed);
    };
  }, [applySession, handleSnapshot, notify, rejoin]);

  const createRoom = useCallback(
    async ({ teamName, color }) => {
      const response = await request('room:create', { teamName, color });
      if (response.ok) {
        applySession({ code: response.code, token: response.token, teamId: response.teamId });
        if (response.snapshot) setSnapshot(response.snapshot);
      }
      return response;
    },
    [applySession, request],
  );

  const joinRoom = useCallback(
    async ({ code, teamName, color }) => {
      const response = await request('room:join', { code, teamName, color });
      if (response.ok) {
        applySession({ code: response.code, token: response.token, teamId: response.teamId });
        if (response.snapshot) setSnapshot(response.snapshot);
      }
      return response;
    },
    [applySession, request],
  );

  const previewRoomRequest = useCallback(
    async (code) => request('room:preview', { code }),
    [request],
  );

  const leaveRoom = useCallback(async () => {
    const response = await request('room:leave');
    applySession(null);
    setSnapshot(null);
    setTimer(null);
    return response;
  }, [applySession, request]);

  const sendChatMessage = useCallback(
    (text) => request('chat:send', { text }),
    [request],
  );

  const command = useCallback((event, payload) => request(event, payload), [request]);

  return {
    connected,
    restoring,
    snapshot,
    timer,
    notice,
    notify,
    clearNotice,
    createRoom,
    joinRoom,
    previewRoom: previewRoomRequest,
    leaveRoom,
    startAuction: () => command('auction:start'),
    bid: (raiseLakh) => command('auction:bid', raiseLakh == null ? {} : { raiseLakh }),
    pauseAuction: () => command('auction:pause'),
    resumeAuction: () => command('auction:resume'),
    skipPlayer: () => {
      const code = snapshotRef.current?.code;
      return command('auction:skip', code ? { code } : {});
    },
    endAuction: () => command('auction:end'),
    fillSquads: () => command('auction:fillSquads'),
    runSimulation: (seed) => command('simulation:run', seed == null ? {} : { seed }),
    updateSettings: (timerSec) => command('settings:update', { timerSec }),
    chatMessages,
    sendChatMessage,
  };
}
