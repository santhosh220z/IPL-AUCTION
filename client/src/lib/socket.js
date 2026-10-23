import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const socket = io();
const SESSION_KEY = 'ipl-auction:session';

function readSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.code || !parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(session) {
  try {
    if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    return;
  }
}

export function useAuctionSocket() {
  const initialSession = useRef(readSession());
  const sessionRef = useRef(initialSession.current);
  const rejoinInFlight = useRef(false);
  const noticeId = useRef(0);

  const [snapshot, setSnapshot] = useState(null);
  const [connected, setConnected] = useState(socket.connected);
  const [restoring, setRestoring] = useState(Boolean(initialSession.current));
  const [timer, setTimer] = useState(null);
  const [notice, setNotice] = useState(null);

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
    writeSession(session);
  }, []);

  const handleSnapshot = useCallback((incoming) => {
    setSnapshot(incoming);
    setRestoring(false);
    if (incoming?.code && sessionRef.current) {
      sessionRef.current = { ...sessionRef.current, code: incoming.code, teamId: incoming.youId };
      writeSession(sessionRef.current);
    }
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

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('room:snapshot', handleSnapshot);
    socket.on('auction:timer', onTimer);
    socket.on('room:closed', onClosed);

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

  const command = useCallback((event, payload) => request(event, payload), [request]);

  return {
    socket,
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
    skipPlayer: () => command('auction:skip'),
    endAuction: () => command('auction:end'),
    fillSquads: () => command('auction:fillSquads'),
    runSimulation: (seed) => command('simulation:run', seed == null ? {} : { seed }),
    updateSettings: (timerSec) => command('settings:update', { timerSec }),
  };
}
