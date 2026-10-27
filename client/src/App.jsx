import { useMemo, useState } from 'react';
import Auction from './components/Auction.jsx';
import Home from './components/Home.jsx';
import Lobby from './components/Lobby.jsx';
import Results from './components/Results.jsx';
import WirePage from './components/WirePage.jsx';
import { LoadingState, Toast } from './components/ui.jsx';
import { normalizeRoomCode } from '../../shared/constants.js';
import { useAuctionSocket } from './lib/socket.js';

function codeFromUrl() {
  try {
    return normalizeRoomCode(new URLSearchParams(window.location.search).get('room') ?? '');
  } catch {
    return '';
  }
}

export default function App() {
  const {
    connected,
    restoring,
    snapshot,
    timer,
    notice,
    notify,
    clearNotice,
    createRoom,
    joinRoom,
    previewRoom,
    leaveRoom,
    startAuction,
    bid,
    pauseAuction,
    resumeAuction,
    skipPlayer,
    endAuction,
    fillSquads,
    runSimulation,
    updateSettings,
    chatMessages,
    sendChatMessage,
  } = useAuctionSocket();

  const initialCode = useMemo(codeFromUrl, []);
  const me = snapshot?.teams.find((team) => team.id === snapshot.youId) ?? null;
  const isHost = Boolean(snapshot && snapshot.hostId === snapshot.youId);
  const [wireView, setWireView] = useState(false);

  let screen;
  if (restoring) {
    screen = (
      <div className="boot">
        <LoadingState>Rejoining the room.</LoadingState>
      </div>
    );
  } else if (!snapshot) {
    screen = <Home initialCode={initialCode} onCreate={createRoom} onJoin={joinRoom} onPreview={previewRoom} />;
  } else if (snapshot.state === 'lobby') {
    screen = (
      <Lobby
        snapshot={snapshot}
        isHost={isHost}
        onStart={startAuction}
        onLeave={leaveRoom}
        onUpdateSettings={updateSettings}
        notify={notify}
      />
    );
  } else if (snapshot.state === 'auction') {
    if (wireView) {
      screen = (
        <WirePage
          snapshot={snapshot}
          onBack={() => setWireView(false)}
        />
      );
    } else {
      screen = (
        <Auction
          snapshot={snapshot}
          timer={timer}
          connected={connected}
          isHost={isHost}
          onBid={bid}
          onPause={pauseAuction}
          onResume={resumeAuction}
          onSkip={skipPlayer}
          onEnd={endAuction}
          notify={notify}
          onOpenPurses={() => {}}
          onOpenWire={() => setWireView(true)}
          onSendChatMessage={sendChatMessage}
          chatMessages={chatMessages}
        />
      );
    }
  } else if (snapshot.state === 'ended') {
    screen = (
      <Results
        snapshot={snapshot}
        isHost={isHost}
        onFillSquads={fillSquads}
        onRunSimulation={runSimulation}
        onLeave={leaveRoom}
        notify={notify}
      />
    );
  } else {
    screen = (
      <div className="boot">
        <LoadingState>Loading the room.</LoadingState>
      </div>
    );
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="site-head">
        <div className="brand">
          <p className="brand-name">The Auction Room</p>
          <p className="brand-sub">IPL 2026 · Local rooms</p>
        </div>

        <div className="site-meta">
          {snapshot ? (
            <p className="room-meta">
              Room <strong>{snapshot.code}</strong>
              {me ? <span> · {me.teamName}</span> : null}
              {isHost ? <span> · Host</span> : null}
            </p>
          ) : null}
          <p className={connected ? 'connection is-live' : 'connection'} aria-live="polite">
            {restoring ? 'Rejoining' : connected ? 'Connected' : 'Reconnecting'}
          </p>
        </div>
      </header>

      {snapshot && !connected ? (
        <p className="connection-banner" role="status">
          Connection lost. Reconnecting to room {snapshot.code}. Bids are on hold for you.
        </p>
      ) : null}

      <div id="main" className="app-main">
        {screen}
      </div>

      <footer className="site-foot">
        <p>Ratings and base prices are generated from IPL delivery data.</p>
        <p>The server owns every bid, timer, and result.</p>
      </footer>

      <Toast notice={notice} onClose={clearNotice} />
    </div>
  );
}
