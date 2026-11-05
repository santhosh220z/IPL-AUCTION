import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { BID_RAISE_LAKH, formatLakh, formatRaiseLakh } from '../../../shared/constants.js';
import {
  formatNumber,
  nationalityLabel,
  pluralize,
  roleLabel,
} from '../lib/format.js';
import { Button, Dialog, EmptyState, TeamMark } from './ui.jsx';
import AuctionHeader from './AuctionHeader.jsx';
import TabBar from './TabBar.jsx';

/* ── Reactive viewport hook ─────────────────────────────── */

function useIsMobile(breakpoint = 900) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < breakpoint,
  );
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}

/* ── Lot clock ──────────────────────────────────────────── */

function useLotClock(auction, timer) {
  const [now, setNow] = useState(Date.now());
  const [base, setBase] = useState(null);
  const lotKeyRef = useRef(null);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, []);

  const lotKey = auction?.current?.status
    ? `${auction.current.status}:${auction.current.player?.id ?? ''}`
    : null;

  useEffect(() => {
    if (!auction || !lotKey) {
      lotKeyRef.current = null;
      return;
    }
    if (lotKeyRef.current !== lotKey) {
      lotKeyRef.current = lotKey;
      setBase({ remainingMs: auction.remainingMs, at: Date.now() });
    }
  }, [auction, lotKey]);

  useEffect(() => {
    if (!timer) return;
    setBase({ remainingMs: timer.remainingMs, at: timer.at });
  }, [timer]);

  if (!auction) return 0;
  if (auction.paused) return auction.remainingMs;
  if (auction.phase !== 'open') return 0;
  if (!base) return auction.remainingMs ?? 0;
  return Math.max(0, base.remainingMs - (now - base.at));
}

/* ── Player stats ───────────────────────────────────────── */

function PlayerStats({ current }) {
  const stats = current?.stats;
  const player = current?.player;
  if (!stats || !player) return null;

  if (!stats.matches) {
    return (
      <p className="lot-note">
        No IPL deliveries in this dataset. The rating is a prior, so this is a projection.
      </p>
    );
  }

  const batting = stats.batting;
  const bowling = stats.bowling;
  const showBatting = player.role === 'Batter' || player.role === 'WK-Batter' || player.role === 'All-rounder';
  const showBowling = player.role === 'Bowler' || player.role === 'All-rounder';

  return (
    <dl className="lot-stats">
      {showBatting ? (
        <>
          <div>
            <dt>Runs</dt>
            <dd>{batting.runs}</dd>
          </div>
          <div>
            <dt>Strike rate</dt>
            <dd>{formatNumber(batting.strikeRate)}</dd>
          </div>
          <div>
            <dt>Average</dt>
            <dd>{formatNumber(batting.average)}</dd>
          </div>
        </>
      ) : null}
      {showBowling ? (
        <>
          <div>
            <dt>Wickets</dt>
            <dd>{bowling.wickets}</dd>
          </div>
          <div>
            <dt>Economy</dt>
            <dd>{formatNumber(bowling.economy, 2)}</dd>
          </div>
          {player.role === 'All-rounder' ? (
            <div>
              <dt>Matches</dt>
              <dd>{stats.matches}</dd>
            </div>
          ) : null}
        </>
      ) : null}
    </dl>
  );
}

/* ── Squad dialog ───────────────────────────────────────── */

function SquadDialog({ team, settings, onClose }) {
  if (!team) return null;
  const spent = team.squad.reduce((sum, player) => sum + player.priceLakh, 0);
  return (
    <Dialog open title={`${team.teamName} squad`} onClose={onClose} wide>
      <div className="squad-summary">
        <p>
          {team.squadCount} {pluralize(team.squadCount, 'player')} bought · {formatLakh(spent)} spent ·{' '}
          {formatLakh(team.purseLakh)} left
        </p>
        <p>
          {team.overseasCount} overseas. Squad limit is {settings?.maxSquad}, with{' '}
          {settings?.maxOverseas} overseas.
        </p>
      </div>
      {team.squad.length === 0 ? (
        <EmptyState title="No players yet.">This team has not won a lot.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">Players bought by {team.teamName}</caption>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Role</th>
                <th scope="col" className="numeric">
                  Rating
                </th>
                <th scope="col" className="numeric">
                  Price
                </th>
              </tr>
            </thead>
            <tbody>
              {team.squad.map((player) => (
                <tr key={player.playerId}>
                  <td>
                    {player.name}
                    {player.overseas ? <span className="cell-note">Overseas</span> : null}
                  </td>
                  <td>{roleLabel(player.role)}</td>
                  <td className="numeric">{formatNumber(player.overall)}</td>
                  <td className="numeric">{formatLakh(player.priceLakh)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}

/* ── Lot content (card · bid buttons · host controls) ──── */

function LotContent({ snapshot, timer, connected, isHost, onBid, onPause, onResume, onSkip, onEnd, notify }) {
  const { auction, teams, settings } = snapshot;
  const current = auction?.current;
  const player = current?.player;
  const leader = current?.leaderTeam;
  const me = teams.find((team) => team.id === snapshot.youId);
  const remaining = useLotClock(auction, timer);
  const [bidPending, setBidPending] = useState(false);
  const [bidError, setBidError] = useState('');
  const [hostBusy, setHostBusy] = useState(false);
  const [squadTeamId, setSquadTeamId] = useState(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [localSkippedPlayerId, setLocalSkippedPlayerId] = useState(null);
  const [skipPending, setSkipPending] = useState(false);

  useEffect(() => {
    setBidError('');
    setLocalSkippedPlayerId(null);
  }, [current?.player?.id]);

  const userSkipped = Boolean(
    current?.userSkipped || (localSkippedPlayerId && localSkippedPlayerId === current?.player?.id),
  );

  const timerSeconds = Math.ceil(remaining / 1000);
  const timerPercent = auction
    ? Math.min(100, Math.max(0, (remaining / (auction.timerSec * 1000)) * 100))
    : 0;
  const isLeader = current?.leaderId === me?.id;
  const squadFull = me ? me.squadCount >= settings.maxSquad : false;
  const overseasBlocked = Boolean(
    me && player?.overseas && me.overseasCount >= settings.maxOverseas,
  );

  let bidBlockedReason = '';
  if (!connected) bidBlockedReason = 'Reconnecting to the server.';
  else if (!auction) bidBlockedReason = 'The auction is not running.';
  else if (auction.paused) bidBlockedReason = 'The auction is paused.';
  else if (auction.phase !== 'open') bidBlockedReason = 'Waiting for the next lot.';
  else if (userSkipped) bidBlockedReason = 'You voted to skip this player.';
  else if (isLeader) bidBlockedReason = 'You hold the highest bid.';
  else if (squadFull) bidBlockedReason = 'Your squad is full.';
  else if (overseasBlocked) bidBlockedReason = 'Your overseas limit is full.';

  const basePrice = current?.basePriceLakh ?? 0;
  const baseUnaffordable = Boolean(me && !current?.leaderId && me.purseLakh < basePrice);
  const raiseButtons = BID_RAISE_LAKH.map((raiseLakh) => {
    const amount = current?.leaderId ? current.currentBidLakh + raiseLakh : null;
    return {
      raiseLakh,
      amount,
      unaffordable: amount != null && (!me || me.purseLakh < amount),
    };
  });
  const raisesAllUnaffordable =
    current?.leaderId && raiseButtons.every((button) => button.unaffordable);
  const bidNote =
    bidBlockedReason ||
    (raisesAllUnaffordable
      ? 'Not enough purse to raise the bid.'
      : baseUnaffordable
        ? 'Not enough purse for the base price.'
        : '');

  async function placeBid(raiseLakh) {
    if (bidPending || !auction?.current || bidBlockedReason) return;
    setBidPending(true);
    setBidError('');
    try {
      const response = await onBid(raiseLakh);
      if (!response?.ok) {
        setBidError(response?.error ?? 'The bid could not be placed.');
      } else if (response.instantlySold) {
        notify(`${player.name} sold to you - all other teams have skipped!`, 'info');
      }
    } catch {
      setBidError('Could not reach the server.');
    } finally {
      setBidPending(false);
    }
  }

  async function handleSkip() {
    if (skipPending || !auction?.current || userSkipped || isLeader) return;
    setSkipPending(true);
    const playerId = current?.player?.id;
    try {
      const response = await onSkip();
      if (!response?.ok) {
        notify(response?.error ?? 'The skip was not recorded.', 'error');
      } else {
        setLocalSkippedPlayerId(playerId);
        if (response.allSkipped) {
          if (response.kind === 'sold') {
            notify(`${player.name} sold - all other teams skipped!`, 'info');
          } else {
            notify(`${player.name} unsold - all teams skipped!`, 'info');
          }
        } else {
          notify(`${player.name} skip recorded. You can no longer bid on this player.`, 'info');
        }
      }
    } catch {
      notify('Could not reach the server.', 'error');
    } finally {
      setSkipPending(false);
    }
  }

  async function hostAction(action, fallback) {
    setHostBusy(true);
    const response = await action();
    setHostBusy(false);
    if (!response.ok) notify(response.error ?? fallback, 'error');
  }

  const squadTeam = teams.find((team) => team.id === squadTeamId) ?? null;

  if (!auction || !current || !player) {
    return (
      <EmptyState title="No lot is open.">
        The auction is moving to the next player. This screen will update on its own.
      </EmptyState>
    );
  }

  const sold = auction.phase === 'sold';
  const unsold = auction.phase === 'unsold';

  return (
    <>
      <div className={sold ? 'lot-card lot-card-sold' : unsold ? 'lot-card lot-card-unsold' : 'lot-card'}>
        <div className="lot-topline">
          <span>{player.set}</span>
          <span>{roleLabel(player.role)}</span>
          <span>{nationalityLabel(player.overseas)}</span>
        </div>
        <h2 id="lot-title" className="lot-name">
          {player.name}
        </h2>
        <p className="lot-meta">
          IPL squad: {player.teamName} · Base price {formatLakh(player.basePriceLakh)}
        </p>

        <div className="lot-ratings" aria-label="Generated player ratings">
          <div>
            <span>Overall</span>
            <strong>{formatNumber(player.ratings.overall)}</strong>
          </div>
          <div>
            <span>Batting</span>
            <strong>{formatNumber(player.ratings.batting)}</strong>
          </div>
          <div>
            <span>Bowling</span>
            <strong>{formatNumber(player.ratings.bowling)}</strong>
          </div>
        </div>

        <PlayerStats current={current} />

        <div className="lot-bid-panel">
          <div className="bid-figures">
            <div>
              <span className="label">{current.leaderId ? 'Current bid' : 'Base price'}</span>
              <strong className="bid-amount">{formatLakh(current.currentBidLakh)}</strong>
            </div>
            {current.leaderId ? (
              <div>
                <span className="label">Raise options</span>
                <span className="bid-next">+{BID_RAISE_LAKH.map(formatRaiseLakh).join(' · ')}</span>
              </div>
            ) : null}
          </div>

          <div className="bid-leader">
            <span className="label">Highest bidder</span>
            <span>{leader ? leader.teamName : 'No bids yet'}</span>
          </div>

          <div className="timer-block">
            <div className="timer-row">
              <span className="label">{auction.paused ? 'Timer paused' : 'Bid timer'}</span>
              <span
                className={
                  !auction.paused && auction.phase === 'open' && timerSeconds <= 5
                    ? 'timer-value is-urgent'
                    : 'timer-value'
                }
              >
                {timerSeconds}s
              </span>
            </div>
            <div className="timer-track" aria-hidden="true">
              <span className="timer-fill" style={{ width: `${timerPercent}%` }} />
            </div>
          </div>

          <div className="bid-actions">
            {current.leaderId ? (
              <div className="bid-raise-grid">
                {raiseButtons.map((button) => (
                  <Button
                    key={button.raiseLakh}
                    variant="accent"
                    className="bid-raise-btn"
                    onClick={() => placeBid(button.raiseLakh)}
                    disabled={Boolean(bidNote) || button.unaffordable || bidPending}
                    title={
                      button.unaffordable
                        ? 'Not enough purse for this bid.'
                        : undefined
                    }
                  >
                    {bidPending ? '…' : `Bid ${formatLakh(button.amount)}`}
                  </Button>
                ))}
              </div>
            ) : (
              <Button
                variant="accent"
                className="bid-button"
                onClick={() => placeBid(null)}
                disabled={Boolean(bidNote) || bidPending}
              >
                {bidPending
                  ? 'Placing bid...'
                  : auction.paused
                    ? 'Auction paused'
                    : auction.phase !== 'open'
                      ? 'Lot closed'
                      : `Bid ${formatLakh(basePrice)}`}
              </Button>
            )}
            <Button
              variant="quiet"
              className="skip-btn"
              onClick={handleSkip}
              disabled={skipPending || userSkipped || isLeader || auction.phase !== 'open' || auction.paused}
              title={
                userSkipped
                  ? 'You voted to skip this player'
                  : isLeader
                    ? 'You hold the highest bid'
                    : 'Vote to skip this player'
              }
            >
              {skipPending ? '…' : userSkipped ? 'Skipped' : 'Skip'}
            </Button>
          </div>
          {bidNote ? <p className="action-note">{bidNote}</p> : null}
          {bidError ? (
            <p className="form-error" role="alert">
              {bidError}
            </p>
          ) : null}
        </div>
      </div>

      {sold || unsold ? (
        <div className={sold ? 'result-stamp result-stamp-sold' : 'result-stamp result-stamp-unsold'}>
          <p className="stamp-label">{sold ? 'Sold' : 'Unsold'}</p>
          <p className="stamp-copy">
            {sold
              ? `${auction.lastEvent?.player?.name ?? player.name} to ${
                  auction.lastEvent?.team?.teamName ?? leader?.teamName ?? 'the room'
                } for ${formatLakh(auction.lastEvent?.priceLakh ?? current.currentBidLakh)}.`
              : `${player.name} goes back into the unsold pool.`}
          </p>
        </div>
      ) : null}

      {isHost ? (
        <section className="host-panel" aria-labelledby="host-title">
          <div className="section-head">
            <h2 id="host-title">Host controls</h2>
            <span className="section-note">Only you</span>
          </div>
          <div className="host-button-grid">
            <Button
              variant="quiet"
              onClick={() =>
                hostAction(
                  auction.paused ? onResume : onPause,
                  auction.paused ? 'The auction did not resume.' : 'The auction did not pause.',
                )
              }
              disabled={hostBusy || auction.phase !== 'open'}
            >
              {auction.paused ? 'Resume auction' : 'Pause auction'}
            </Button>
            <Button variant="danger" onClick={() => setConfirmEnd(true)} disabled={hostBusy}>
              End auction
            </Button>
          </div>
        </section>
      ) : null}

      <p className="visually-hidden" aria-live="polite">
        {sold
          ? `Sold. ${player.name} to ${leader?.teamName ?? 'a team'} for ${formatLakh(current.currentBidLakh)}.`
          : unsold
            ? `Unsold. ${player.name} returns to the pool.`
            : `${player.name} is on the block. The bid is ${formatLakh(current.currentBidLakh)}.`}
      </p>

      <SquadDialog team={squadTeam} settings={settings} onClose={() => setSquadTeamId(null)} />

      <Dialog
        open={confirmEnd}
        title="End the auction?"
        onClose={() => setConfirmEnd(false)}
        footer={
          <div className="dialog-actions">
            <Button variant="quiet" onClick={() => setConfirmEnd(false)}>
              Keep auction running
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmEnd(false);
                hostAction(onEnd, 'The auction did not end.');
              }}
            >
              End auction
            </Button>
          </div>
        }
      >
        <p>
          The current lot will be dropped. Teams with fewer than 11 players can be filled from the
          unsold pool before the tournament.
        </p>
      </Dialog>
    </>
  );
}

/* ── Purses tab ─────────────────────────────────────────── */

function PursesTab({ snapshot }) {
  const { teams, settings, code, youId } = snapshot;
  const [squadTeamId, setSquadTeamId] = useState(null);

  return (
    <div className="tab-panels">
      <section className="tab-panel" id="purses-panel" role="tabpanel" aria-labelledby="purses-tab" aria-hidden="false">
        <header className="purses-tab-header">
          <p className="page-kicker">Room {code}</p>
        </header>
        <ul className="purse-rows-tab" aria-label="Team purses">
          {teams.map((team) => (
            <li className="purse-row-tab" key={team.id}>
              <TeamMark name={team.teamName} color={team.color} size="small" />
              <div className="purse-row-tab-body">
                <p className="purse-row-tab-name">
                  {team.teamName}
                  {team.id === youId ? <span className="row-tag">You</span> : null}
                </p>
                <p className="purse-row-tab-meta">
                  {formatLakh(team.purseLakh)} remaining · {team.squadCount}/{settings.maxSquad} players ·{' '}
                  {team.overseasCount}/{settings.maxOverseas} overseas
                </p>
              </div>
              <Button
                variant="quiet"
                className="row-action"
                aria-label={`View ${team.teamName} squad`}
                onClick={() => setSquadTeamId(team.id)}
              >
                Squad
              </Button>
            </li>
          ))}
        </ul>

        <SquadDialog team={teams.find((t) => t.id === squadTeamId)} settings={settings} onClose={() => setSquadTeamId(null)} />
      </section>
    </div>
  );
}

/* ── Mobile Chat Live Bid Banner ────────────────────────── */

function ChatBidBanner({ snapshot, timer, connected, onBid, onSkip, notify }) {
  const { auction, settings } = snapshot;
  const current = auction?.current;
  const player = current?.player;
  const leader = current?.leaderTeam;
  const me = snapshot.teams.find((t) => t.id === snapshot.youId);
  const remaining = useLotClock(auction, timer);
  const [bidPending, setBidPending] = useState(false);
  const [skipPending, setSkipPending] = useState(false);
  const [localSkippedPlayerId, setLocalSkippedPlayerId] = useState(null);

  useEffect(() => {
    setLocalSkippedPlayerId(null);
  }, [current?.player?.id]);

  if (!auction || !current || !player) return null;

  const sold = auction.phase === 'sold';
  const unsold = auction.phase === 'unsold';
  const timerSeconds = Math.ceil(remaining / 1000);
  const timerPercent = auction
    ? Math.min(100, Math.max(0, (remaining / (auction.timerSec * 1000)) * 100))
    : 0;

  const userSkipped = Boolean(
    current?.userSkipped || (localSkippedPlayerId && localSkippedPlayerId === current?.player?.id),
  );
  const isLeader = current?.leaderId === me?.id;
  const squadFull = me ? me.squadCount >= settings.maxSquad : false;
  const overseasBlocked = Boolean(
    me && player?.overseas && me.overseasCount >= settings.maxOverseas,
  );

  let bidBlockedReason = '';
  if (!connected) bidBlockedReason = 'Reconnecting';
  else if (auction.paused) bidBlockedReason = 'Paused';
  else if (auction.phase !== 'open') bidBlockedReason = 'Closed';
  else if (userSkipped) bidBlockedReason = 'Skipped';
  else if (isLeader) bidBlockedReason = 'You lead';
  else if (squadFull) bidBlockedReason = 'Squad full';
  else if (overseasBlocked) bidBlockedReason = 'Overseas limit';

  const basePrice = current.basePriceLakh ?? 0;
  const baseUnaffordable = Boolean(me && !current.leaderId && me.purseLakh < basePrice);
  const raiseButtons = BID_RAISE_LAKH.map((raiseLakh) => {
    const amount = current.leaderId ? current.currentBidLakh + raiseLakh : null;
    return {
      raiseLakh,
      amount,
      unaffordable: amount != null && (!me || me.purseLakh < amount),
    };
  });

  async function placeBid(raiseLakh) {
    if (bidPending || !auction?.current || bidBlockedReason) return;
    setBidPending(true);
    try {
      const response = await onBid(raiseLakh);
      if (!response?.ok) {
        notify(response?.error ?? 'The bid could not be placed.', 'error');
      } else if (response.instantlySold) {
        notify(`${player.name} sold to you - all other teams skipped!`, 'info');
      }
    } catch {
      notify('Could not reach the server.', 'error');
    } finally {
      setBidPending(false);
    }
  }

  async function handleSkip() {
    if (skipPending || !auction?.current || userSkipped || isLeader) return;
    setSkipPending(true);
    const playerId = current?.player?.id;
    try {
      const response = await onSkip();
      if (!response?.ok) {
        notify(response?.error ?? 'The skip was not recorded.', 'error');
      } else {
        setLocalSkippedPlayerId(playerId);
        if (response.allSkipped) {
          if (response.kind === 'sold') {
            notify(`${player.name} sold - all other teams skipped!`, 'info');
          } else {
            notify(`${player.name} unsold - all teams skipped!`, 'info');
          }
        } else {
          notify(`${player.name} skip recorded.`, 'info');
        }
      }
    } catch {
      notify('Could not reach the server.', 'error');
    } finally {
      setSkipPending(false);
    }
  }

  return (
    <aside className="chat-bid-banner" aria-label="Current lot live bidding">
      <div className="chat-bid-track" aria-hidden="true">
        <span
          className={!auction.paused && auction.phase === 'open' && timerSeconds <= 5 ? 'chat-bid-fill is-urgent' : 'chat-bid-fill'}
          style={{ width: `${timerPercent}%` }}
        />
      </div>

      <div className="chat-bid-top">
        <div className="chat-bid-player-info">
          <span className="chat-bid-player-name">{player.name}</span>
          <span className="chat-bid-player-role">
            {roleLabel(player.role)} {player.overseas ? '· Overseas' : ''}
          </span>
        </div>

        <div className="chat-bid-timer-pill">
          {auction.paused ? (
            <span className="timer-pill is-paused">Paused</span>
          ) : auction.phase === 'open' ? (
            <span className={timerSeconds <= 5 ? 'timer-pill is-urgent' : 'timer-pill'}>
              ⏱️ {timerSeconds}s
            </span>
          ) : (
            <span className={sold ? 'timer-pill is-sold' : 'timer-pill is-unsold'}>
              {sold ? 'Sold' : 'Unsold'}
            </span>
          )}
        </div>
      </div>

      <div className="chat-bid-status-line">
        <div className="chat-bid-figure">
          <span className="chat-bid-label">{current.leaderId ? 'Current' : 'Base'}:</span>
          <strong>{formatLakh(current.currentBidLakh)}</strong>
          {leader ? (
            <span className="chat-bid-leader">
              by <strong style={{ color: isLeader ? 'var(--green)' : 'inherit' }}>
                {isLeader ? 'You' : leader.teamName}
              </strong>
            </span>
          ) : (
            <span className="chat-bid-leader">(Opening)</span>
          )}
        </div>
        {isLeader && <span className="chat-bid-leading-badge">Leading</span>}
        {userSkipped && <span className="chat-bid-skipped-badge">Skipped</span>}
      </div>

      {auction.phase === 'open' && (
        <div className="chat-bid-actions">
          {current.leaderId ? (
            <div className="chat-bid-raise-group">
              {raiseButtons.map((btn) => (
                <button
                  key={btn.raiseLakh}
                  type="button"
                  className="chat-bid-chip"
                  onClick={() => placeBid(btn.raiseLakh)}
                  disabled={Boolean(bidBlockedReason) || btn.unaffordable || bidPending}
                  title={btn.unaffordable ? 'Not enough purse' : `Bid ${formatLakh(btn.amount)}`}
                >
                  +{formatRaiseLakh(btn.raiseLakh)}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              className="chat-bid-btn-primary"
              onClick={() => placeBid(null)}
              disabled={Boolean(bidBlockedReason) || baseUnaffordable || bidPending}
            >
              {bidPending ? '…' : `Bid ${formatLakh(basePrice)}`}
            </button>
          )}

          <button
            type="button"
            className="chat-bid-chip is-skip"
            onClick={handleSkip}
            disabled={skipPending || userSkipped || isLeader || bidBlockedReason === 'Paused'}
            title="Skip this player"
          >
            {skipPending ? '…' : userSkipped ? 'Skipped' : 'Skip'}
          </button>
        </div>
      )}
    </aside>
  );
}

/* ── Chat tab ───────────────────────────────────────────── */

function ChatTab({
  snapshot,
  messages,
  onSendMessage,
  connected,
  isSidebar = false,
  timer,
  onBid,
  onSkip,
  notify,
  showBidBanner = false,
}) {
  const { code } = snapshot;
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend(event) {
    event.preventDefault();
    const text = inputValue.trim();
    if (!text) return;
    onSendMessage(text);
    setInputValue('');
  }

  function renderSystemMessage(msg) {
    const { event, ...payload } = msg;
    switch (event) {
      case 'bid':
        return (
          <>
            <span className="system-icon">💰</span>
            <strong>{payload.teamName}</strong> bid <strong>{payload.priceLakh}L</strong> for {payload.playerName}
          </>
        );
      case 'sold':
        return (
          <>
            <span className="system-icon">✅</span>
            <strong>{payload.playerName}</strong> sold to <strong>{payload.teamName}</strong> for <strong>{payload.priceLakh}L</strong>
            {payload.viaSkip && <span className="system-via"> (via skip)</span>}
          </>
        );
      case 'unsold':
        return (
          <>
            <span className="system-icon">❌</span>
            <strong>{payload.playerName}</strong> unsold
            {payload.viaSkip && <span className="system-via"> (all teams skipped)</span>}
          </>
        );
      case 'skip':
        return (
          <>
            <span className="system-icon">⏭️</span>
            <strong>{payload.byTeamName}</strong> voted to skip <strong>{payload.playerName}</strong>
          </>
        );
      case 'pause':
        return (
          <>
            <span className="system-icon">⏸️</span>
            Auction paused by <strong>{payload.byTeamName}</strong>
            {payload.playerName && <span> on <strong>{payload.playerName}</strong></span>}
          </>
        );
      case 'resume':
        return (
          <>
            <span className="system-icon">▶️</span>
            Auction resumed by <strong>{payload.byTeamName}</strong>
            {payload.playerName && <span> for <strong>{payload.playerName}</strong></span>}
          </>
        );
      case 'end':
        return (
          <>
            <span className="system-icon">🏁</span>
            Auction ended by <strong>{payload.byTeamName}</strong>
            <span className="system-stats"> — {payload.totalSold} sold, {payload.totalUnsold} unsold</span>
          </>
        );
      case 'restart':
        return (
          <>
            <span className="system-icon">🔄</span>
            Room restarted by <strong>{payload.byTeamName}</strong> for a new auction!
          </>
        );
      default:
        return <span>{msg.text || 'System message'}</span>;
    }
  }

  const content = (
    <section className="tab-panel chat-tab" id="chat-panel" role="tabpanel" aria-labelledby="chat-tab" aria-hidden="false">
      {!isSidebar && (
        <header className="chat-header">
          <p className="page-kicker">Room {code}</p>
        </header>
      )}

      {showBidBanner && (
        <ChatBidBanner
          snapshot={snapshot}
          timer={timer}
          connected={connected}
          onBid={onBid}
          onSkip={onSkip}
          notify={notify}
        />
      )}

      <div className="chat-messages" role="log" aria-live="polite" aria-label="Chat messages">
        {messages.length === 0 ? (
          <p className="empty-state" style={{ textAlign: 'center', color: 'var(--ink-soft)', padding: '24px 0' }}>
            No messages yet. Start the conversation!
          </p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`chat-message ${msg.type}`}
            >
              <div className="chat-message-meta">
                {msg.type === 'system' ? (
                  <span className="system-sender">📢 System</span>
                ) : (
                  <>
                    <span className="chat-message-team">
                      <span
                        className="chat-message-team-mark"
                        style={{
                          borderColor: msg.teamColor,
                          background: `color-mix(in srgb, ${msg.teamColor} 16%, var(--paper))`,
                          color: msg.teamColor,
                        }}
                      >
                        {msg.teamName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                      </span>
                      <span>{msg.teamName}</span>
                    </span>
                  </>
                )}
                <time className="chat-message-time" dateTime={new Date(msg.at).toISOString()}>
                  {new Date(msg.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </time>
              </div>
              <p className="chat-message-text">
                {msg.type === 'system' ? renderSystemMessage(msg) : msg.text}
              </p>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      <form className="chat-input-bar" onSubmit={handleSend}>
        <input
          type="text"
          className="chat-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Type a message..."
          aria-label="Chat message"
          autoComplete="off"
          disabled={!connected}
        />
        <Button type="submit" variant="accent" className="chat-send-btn" disabled={!inputValue.trim() || !connected}>
          Send
        </Button>
      </form>
    </section>
  );

  return isSidebar ? content : <div className="tab-panels">{content}</div>;
}

/* ── Main auction layout ────────────────────────────────── */

export default function Auction({
  snapshot,
  timer,
  connected,
  isHost,
  onBid,
  onPause,
  onResume,
  onSkip,
  onEnd,
  notify,
  onOpenPurses,
  onOpenWire,
  onSendChatMessage,
  chatMessages = [],
}) {
  const [activeTab, setActiveTab] = useState('lot');
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [desktopSidebarTab, setDesktopSidebarTab] = useState('wire');
  const [desktopPursesOpen, setDesktopPursesOpen] = useState(false);
  const [desktopSquadTeamId, setDesktopSquadTeamId] = useState(null);
  const isMobile = useIsMobile();

  // Track unread messages when not on chat tab
  useEffect(() => {
    const viewingChat = isMobile ? activeTab === 'chat' : desktopSidebarTab === 'chat';
    if (!viewingChat && chatMessages.length > 0) {
      setUnreadChatCount(chatMessages.length);
    } else if (viewingChat) {
      setUnreadChatCount(0);
    }
  }, [chatMessages, activeTab, desktopSidebarTab, isMobile]);

  const handleTabChange = useCallback((tabId) => {
    setActiveTab(tabId);
    if (tabId === 'chat') setUnreadChatCount(0);
  }, []);

  // Wire header buttons to tab navigation or desktop modal
  const handleOpenPurses = useCallback(() => {
    if (isMobile) {
      setActiveTab('purses');
    } else {
      setDesktopPursesOpen(true);
      if (onOpenPurses) onOpenPurses();
    }
  }, [isMobile, onOpenPurses]);

  const { auction } = snapshot;
  const log = useMemo(() => (auction ? [...auction.log].reverse() : []), [auction?.log]);

  const lotContentProps = {
    snapshot,
    timer,
    connected,
    isHost,
    onBid,
    onPause,
    onResume,
    onSkip,
    onEnd,
    notify,
  };

  if (isMobile) {
    const renderTabContent = () => {
      switch (activeTab) {
        case 'lot':
          return (
            <main className="auction">
              {auction && (
                <AuctionHeader
                  auction={auction}
                  settings={snapshot.settings}
                  code={snapshot.code}
                  onOpenPurses={handleOpenPurses}
                  onOpenWire={onOpenWire}
                  isMobile={true}
                />
              )}
              <div className="lot-tab-content">
                <LotContent {...lotContentProps} />
              </div>
            </main>
          );
        case 'purses':
          return <PursesTab snapshot={snapshot} />;
        case 'chat':
          return (
            <ChatTab
              snapshot={snapshot}
              messages={chatMessages}
              onSendMessage={onSendChatMessage}
              connected={connected}
              timer={timer}
              onBid={onBid}
              onSkip={onSkip}
              notify={notify}
              showBidBanner={true}
            />
          );
        default:
          return null;
      }
    };

    return (
      <>
        {renderTabContent()}
        <TabBar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          unreadChatCount={unreadChatCount}
        />
      </>
    );
  }

  // ── Desktop layout ──────────────────────────────────────
  return (
    <main className="auction">
      {auction && (
        <AuctionHeader
          auction={auction}
          settings={snapshot.settings}
          code={snapshot.code}
          onOpenPurses={handleOpenPurses}
          onOpenWire={onOpenWire}
          isMobile={false}
        />
      )}

      <div className="auction-grid">
        <section className="auction-lot" aria-labelledby="lot-title">
          <LotContent {...lotContentProps} />
        </section>

        <aside className="auction-wire" aria-labelledby="wire-title">
          <div className="desktop-sidebar-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={desktopSidebarTab === 'wire'}
              className={`desktop-sidebar-tab-btn ${desktopSidebarTab === 'wire' ? 'is-active' : ''}`}
              onClick={() => setDesktopSidebarTab('wire')}
            >
              The Wire
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={desktopSidebarTab === 'chat'}
              className={`desktop-sidebar-tab-btn ${desktopSidebarTab === 'chat' ? 'is-active' : ''}`}
              onClick={() => {
                setDesktopSidebarTab('chat');
                setUnreadChatCount(0);
              }}
            >
              Chat {unreadChatCount > 0 && <span className="tab-badge">{unreadChatCount}</span>}
            </button>
          </div>

          {desktopSidebarTab === 'wire' ? (
            <section className="wire-panel" aria-labelledby="wire-title">
              <div className="section-head">
                <h2 id="wire-title">The wire</h2>
                <span className="section-note">
                  {log.length > 12 ? `Latest 12 of ${log.length}` : 'Latest first'}
                </span>
              </div>
              {log.length === 0 ? (
                <EmptyState title="No lots settled yet.">The first bid opens the night.</EmptyState>
              ) : (
                <ol className="wire-list">
                  {log.slice(0, 12).map((event) => (
                    <li key={event.id} className={event.type === 'sold' ? 'wire-item is-sold' : 'wire-item'}>
                      <span className="wire-type">{event.type === 'sold' ? 'Sold' : 'Unsold'}</span>
                      <span className="wire-player">{event.player?.name}</span>
                      <span className="wire-detail">
                        {event.type === 'sold'
                          ? `${event.team?.teamName ?? 'Team'} · ${formatLakh(event.priceLakh)}`
                          : 'Back in the pool'}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ) : (
            <ChatTab
              snapshot={snapshot}
              messages={chatMessages}
              onSendMessage={onSendChatMessage}
              connected={connected}
              isSidebar={true}
            />
          )}
        </aside>
      </div>

      {desktopPursesOpen && (
        <Dialog
          open
          title="Team Purses"
          onClose={() => {
            setDesktopPursesOpen(false);
            setDesktopSquadTeamId(null);
          }}
          wide
        >
          <ul className="purse-rows-tab" aria-label="Team purses">
            {snapshot.teams.map((team) => (
              <li className="purse-row-tab" key={team.id}>
                <TeamMark name={team.teamName} color={team.color} size="small" />
                <div className="purse-row-tab-body">
                  <p className="purse-row-tab-name">
                    {team.teamName}
                    {team.id === snapshot.youId ? <span className="row-tag">You</span> : null}
                  </p>
                  <p className="purse-row-tab-meta">
                    {formatLakh(team.purseLakh)} remaining · {team.squadCount}/{snapshot.settings.maxSquad} players ·{' '}
                    {team.overseasCount}/{snapshot.settings.maxOverseas} overseas
                  </p>
                </div>
                <Button
                  variant="quiet"
                  className="row-action"
                  aria-label={`View ${team.teamName} squad`}
                  onClick={() => setDesktopSquadTeamId(team.id)}
                >
                  Squad
                </Button>
              </li>
            ))}
          </ul>
        </Dialog>
      )}

      <SquadDialog
        team={snapshot.teams.find((t) => t.id === desktopSquadTeamId)}
        settings={snapshot.settings}
        onClose={() => setDesktopSquadTeamId(null)}
      />
    </main>
  );
}
