import { formatLakh } from '../../../shared/constants.js';
import { Button } from './ui.jsx';

export default function AuctionHeader({
  auction,
  settings,
  code,
  onOpenPurses,
  onOpenWire,
  isMobile = false,
}) {
  const lotNumber = Math.min(auction.index + 1, auction.totalCount);
  const isPaused = auction.paused;

  if (isMobile) {
    return (
      <header className="auction-header auction-header-mobile">
        <div className="header-main">
          <p className="page-kicker">Lot {lotNumber} of {auction.totalCount}</p>
          <span className={`status-badge ${isPaused ? 'is-paused' : 'is-live'}`}>
            {isPaused ? 'Paused' : 'Live'}
          </span>
        </div>
        <div className="header-actions">
          <Button variant="quiet" className="icon-btn" onClick={onOpenPurses} aria-label="Team purses">
            <span aria-hidden="true">💰</span>
            <span className="btn-text">Purses</span>
          </Button>
          <Button variant="quiet" className="icon-btn" onClick={onOpenWire} aria-label="Auction history">
            <span aria-hidden="true">📜</span>
            <span className="btn-text">Wire</span>
          </Button>
        </div>
      </header>
    );
  }

  return (
    <header className="auction-header auction-header-desktop">
      <div className="header-main">
        <p className="page-kicker">
          Lot {lotNumber} of {auction.totalCount} · {auction.queueRemaining} left after this
        </p>
        <span className={`status-badge ${isPaused ? 'is-paused' : 'is-live'}`}>
          {isPaused ? 'Paused' : 'Live'}
        </span>
      </div>
      <div className="header-actions">
        <div className="auction-status">
          <span className="status-note">{auction.soldCount} sold · {auction.unsoldCount} unsold</span>
        </div>
        <Button variant="quiet" className="purses-btn" onClick={onOpenPurses}>
          Purses
        </Button>
        <Button variant="quiet" onClick={onOpenWire}>
          View Wire
        </Button>
      </div>
    </header>
  );
}