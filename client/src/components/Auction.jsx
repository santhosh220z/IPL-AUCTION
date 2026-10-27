import { useEffect, useMemo, useRef, useState } from 'react';
import { BID_RAISE_LAKH, formatLakh, formatRaiseLakh } from '../../../shared/constants.js';
import {
  formatNumber,
  nationalityLabel,
  pluralize,
  roleLabel,
} from '../lib/format.js';
import { Button, Dialog, EmptyState, TeamMark } from './ui.jsx';

function useLotClock(auction, timer) {
  const [now, setNow] = useState(Date.now());
  // Single source of truth: timer events (500ms) drive the countdown while a
  // lot stays open; the snapshot only adopts the base once per lot transition.
  // A snapshot adopted on every broadcast could restart the countdown from an
  // older value and make the clock jump backwards.
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
}) {
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

  useEffect(() => {
    setBidError('');
    setLocalSkippedPlayerId(null);
  }, [current?.player?.id]);

  const userSkipped = Boolean(
    current?.userSkipped || (localSkippedPlayerId && localSkippedPlayerId === current?.player?.id),
  );

  const timerSeconds = Math.ceil(remaining / 1000);
  const timerPercent = auction ? Math.min(100, Math.max(0, (remaining / (auction.timerSec * 1000)) * 100)) : 0;
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

  const [skipPending, setSkipPending] = useState(false);

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
  const log = useMemo(() => (auction ? [...auction.log].reverse() : []), [auction?.log]);

  if (!auction || !current || !player) {
    return (
      <main className="auction">
        <EmptyState title="No lot is open.">
          The auction is moving to the next player. This screen will update on its own.
        </EmptyState>
      </main>
    );
  }

  const sold = auction.phase === 'sold';
  const unsold = auction.phase === 'unsold';
  const lotNumber = Math.min(auction.index + 1, auction.totalCount);

  return (
    <main className="auction">
      <section className="auction-head" aria-label="Auction status">
        <div className="auction-head-main">
          <p className="page-kicker">
            Lot {lotNumber} of {auction.totalCount} · {auction.queueRemaining} left after this
          </p>
          <span className={`status-badge ${auction.paused ? 'is-paused' : 'is-live'}`}>
            {auction.paused ? 'Paused' : 'Live'}
          </span>
        </div>
        <div className="auction-head-actions">
          <Button variant="quiet" className="purses-btn" onClick={onOpenPurses}>
            Purses
          </Button>
          <div className="auction-status">
            <span className="status-note">{auction.soldCount} sold · {auction.unsoldCount} unsold</span>
          </div>
        </div>
      </section>

      <div className="auction-grid">
        <section className="auction-lot" aria-labelledby="lot-title">
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
        </section>

        <aside className="auction-wire" aria-labelledby="wire-title">
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
        </aside>
      </div>

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
    </main>
  );
}
