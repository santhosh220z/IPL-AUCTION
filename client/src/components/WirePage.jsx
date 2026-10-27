import { formatLakh } from '../../../shared/constants.js';
import { formatNumber, roleLabel } from '../lib/format.js';
import { Button, TeamMark } from './ui.jsx';

function WirePage({ snapshot, onBack }) {
  const { auction, teams, code } = snapshot;
  const log = auction ? [...auction.log].reverse() : [];

  function handleBack() {
    if (onBack) onBack();
  }

  if (!auction) {
    return (
      <main className="wire-page">
        <header className="wire-page-header">
          <Button variant="quiet" className="back-btn" onClick={handleBack}>
            ← Back to Auction
          </Button>
          <div className="wire-page-title">
            <p className="page-kicker">Room {code}</p>
            <h1>Auction Wire</h1>
          </div>
        </header>
        <p className="empty-state">No auction data available.</p>
      </main>
    );
  }

  return (
    <main className="wire-page">
      <header className="wire-page-header">
        <Button variant="quiet" className="back-btn" onClick={handleBack}>
          ← Back to Auction
        </Button>
        <div className="wire-page-title">
          <p className="page-kicker">Room {code}</p>
          <h1>Auction Wire</h1>
        </div>
      </header>

      <div className="wire-summary">
        <span className="status-note">
          {auction.soldCount} sold · {auction.unsoldCount} unsold · Lot {auction.index + 1} of {auction.totalCount}
        </span>
      </div>

      <section className="wire-log" aria-labelledby="wire-log-title">
        <div className="section-head">
          <h2 id="wire-log-title">All Lots</h2>
          <span className="section-note">{log.length} {log.length === 1 ? 'lot' : 'lots'} settled</span>
        </div>
        {log.length === 0 ? (
          <p className="empty-state" style={{ textAlign: 'center', color: 'var(--ink-soft)', padding: '24px 0' }}>
            No lots settled yet. The first bid opens the night.
          </p>
        ) : (
          <ol className="wire-log">
            {log.map((event) => (
              <li key={event.id} className={`wire-log-item ${event.type}`}>
                <span className="wire-log-type">{event.type === 'sold' ? 'Sold' : 'Unsold'}</span>
                <span className="wire-log-player">{event.player?.name}</span>
                <div className="wire-log-detail">
                  {event.type === 'sold' ? (
                    <>
                      <span className="wire-log-team">
                        <TeamMark name={event.team?.teamName ?? 'Team'} color={event.team?.color ?? 'emerald'} size="small" />
                        <span>{event.team?.teamName ?? 'Team'}</span>
                      </span>
                      <span className="wire-log-price">{formatLakh(event.priceLakh)}</span>
                    </>
                  ) : (
                    <span>Back in the pool</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

export default WirePage;