import { useEffect, useState } from 'react';
import { TIMER_OPTIONS, formatLakh } from '../../../shared/constants.js';
import { Button, CopyButton, TeamMark } from './ui.jsx';

export default function Lobby({
  snapshot,
  isHost,
  onStart,
  onLeave,
  onUpdateSettings,
  notify,
}) {
  const [starting, setStarting] = useState(false);
  const [savingTimer, setSavingTimer] = useState(false);
  const [lanOrigin, setLanOrigin] = useState(window.location.origin);

  useEffect(() => {
    let active = true;
    fetch('/api/lan')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active && data?.baseUrl) setLanOrigin(data.baseUrl);
        else if (active) notify('Invite links may point at this dev port. Use `npm run lan` for LAN play.', 'info');
      })
      .catch(() => {
        if (active) notify('Invite links may point at this dev port. Use `npm run lan` for LAN play.', 'info');
      });
    return () => {
      active = false;
    };
  }, [notify]);

  const { teams, settings, code, hostId } = snapshot;
  const teamCount = teams.length;
  const canStart = teamCount >= 2;
  const inviteUrl = `${lanOrigin}${window.location.pathname}?room=${code}`;

  async function start() {
    setStarting(true);
    const response = await onStart();
    setStarting(false);
    if (!response.ok) notify(response.error ?? 'The auction could not start.', 'error');
  }

  async function changeTimer(event) {
    const timerSec = Number(event.target.value);
    setSavingTimer(true);
    const response = await onUpdateSettings(timerSec);
    setSavingTimer(false);
    if (!response.ok) notify(response.error ?? 'The timer could not be saved.', 'error');
  }

  return (
    <main className="lobby">
      <section className="lobby-head">
        <div>
          <p className="page-kicker">Room {code}</p>
          <h1>The room is filling.</h1>
          <p className="page-intro">
            {teamCount} of {snapshot.settings.maxTeams} teams are in. Share the code, then the
            host starts the auction.
          </p>
        </div>
        <div className="room-code-panel">
          <span className="label">Room code</span>
          <span className="room-code">{code}</span>
          <div className="room-code-actions">
            <CopyButton value={code} label="Copy code" />
            <CopyButton value={inviteUrl} label="Copy invite link" />
          </div>
        </div>
      </section>

      <div className="lobby-grid">
        <section className="lobby-teams" aria-labelledby="teams-title">
          <div className="section-head">
            <h2 id="teams-title">Teams at the table</h2>
            <span className="section-note">
              {teamCount} of {settings.maxTeams}
            </span>
          </div>

          {teamCount === 1 ? (
            <p className="lobby-wait">One more team is needed before the auction can start.</p>
          ) : (
            <p className="lobby-wait">The auction can start. Late teams can still join until then.</p>
          )}

          <ul className="team-list">
            {teams.map((team) => (
              <li className="team-row" key={team.id}>
                <TeamMark name={team.teamName} color={team.color} />
                <div className="team-row-body">
                  <p className="team-row-name">{team.teamName}</p>
                  <p className="team-row-meta">
                    {formatLakh(team.purseLakh)} purse · {team.squadCount} players
                    {team.id === snapshot.youId ? ' · Your team' : ''}
                    {team.id === hostId ? ' · Host' : ''}
                  </p>
                </div>
                <span className={team.connected ? 'team-state is-online' : 'team-state'}>
                  {team.connected ? 'Online' : 'Offline'}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <aside className="lobby-controls" aria-labelledby="controls-title">
          <div className="section-head">
            <h2 id="controls-title">Room settings</h2>
          </div>

          <div className="settings-row">
            <div>
              <p className="settings-label">Bid timer</p>
              <p className="settings-copy">Every bid resets the clock.</p>
            </div>
            {isHost ? (
              <label className="select-wrap">
                <span className="visually-hidden">Bid timer</span>
                <select
                  className="select"
                  value={settings.timerSec}
                  onChange={changeTimer}
                  disabled={savingTimer}
                >
                  {TIMER_OPTIONS.map((seconds) => (
                    <option value={seconds} key={seconds}>
                      {seconds} seconds
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="settings-value">{settings.timerSec} seconds</span>
            )}
          </div>

          <div className="settings-row">
            <div>
              <p className="settings-label">Purse and squad</p>
              <p className="settings-copy">Locked for the auction.</p>
            </div>
            <span className="settings-value">
              {formatLakh(settings.purseLakh)} · {settings.maxSquad} players
            </span>
          </div>

          <div className="settings-row">
            <div>
              <p className="settings-label">Overseas cap</p>
              <p className="settings-copy">Maximum overseas players in a squad.</p>
            </div>
            <span className="settings-value">{settings.maxOverseas}</span>
          </div>

          <div className="settings-row settings-row-last">
            <div>
              <p className="settings-label">Auction order</p>
              <p className="settings-copy">Shuffled for this room. Nobody sees the next lot.</p>
            </div>
            <span className="settings-value">{settings.lotCount} lots</span>
          </div>

          {isHost ? (
            <div className="host-actions">
              <Button variant="accent" onClick={start} disabled={!canStart || starting}>
                {starting ? 'Starting the auction...' : 'Start auction'}
              </Button>
              {!canStart ? (
                <p className="action-note">Wait for a second team before starting.</p>
              ) : (
                <p className="action-note">The timer starts with the first lot.</p>
              )}
              <Button variant="quiet" onClick={onLeave}>
                Leave room
              </Button>
            </div>
          ) : (
            <div className="waiting-note">
              <p className="settings-label">Waiting for the host</p>
              <p className="settings-copy">
                {snapshot.hostId
                  ? 'The host starts the auction when the room is ready.'
                  : 'The host has left. The next team will take over.'}
              </p>
              <Button variant="quiet" onClick={onLeave}>
                Leave room
              </Button>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
