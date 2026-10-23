import { describe, expect, it } from 'vitest';
import {
  advanceAuction,
  beginNextPlayer,
  computeRemaining,
  createAuctionState,
  endAuction,
  fillSquads,
  getBidState,
  nextBidFor,
  pauseAuction,
  placeBid,
  resumeAuction,
  settleCurrent,
  shuffleLots,
} from '../auction.js';
import { nextBidLakh } from '../../shared/constants.js';

function player(id, basePriceLakh, overseas = false) {
  return {
    id,
    name: id,
    role: 'Batter',
    overseas,
    basePriceLakh,
    ratings: { overall: 60 },
  };
}

function team(id, name) {
  return {
    id,
    teamName: name,
    color: 'azure',
    purseLakh: 12000,
    squad: [],
    overseasCount: 0,
    connected: true,
  };
}

function makeFixture() {
  const playersById = new Map();
  for (let i = 1; i <= 12; i += 1) {
    playersById.set(`p${i}`, player(`p${i}`, 100 + i));
  }
  const room = {
    state: 'auction',
    teams: new Map(),
    auction: createAuctionState([...playersById.keys()], 15),
  };
  const t1 = team('t1', 'Alpha');
  const t2 = team('t2', 'Beta');
  room.teams.set(t1.id, t1);
  room.teams.set(t2.id, t2);
  return { room, t1, t2, playersById };
}

describe('bid increments', () => {
  it('uses the first bid at base price and then tiered increments', () => {
    expect(nextBidLakh(99, false)).toBe(99);
    expect(nextBidLakh(99, true)).toBe(104);
    expect(nextBidLakh(100, true)).toBe(110);
    expect(nextBidLakh(499, true)).toBe(509);
    expect(nextBidLakh(500, true)).toBe(520);
    expect(nextBidLakh(999, true)).toBe(1019);
    expect(nextBidLakh(1000, true)).toBe(1025);
  });

  it('returns base price until a leader exists', () => {
    const { room, playersById } = makeFixture();
    beginNextPlayer(room, playersById, 1000);
    expect(nextBidFor(room.auction)).toBe(101);
    placeBid(room, 't1', playersById, 2000);
    expect(nextBidFor(room.auction)).toBe(111);
  });
});

describe('auction bidding', () => {
  it('rejects self-outbids and bids from a paused auction', () => {
    const { room, playersById } = makeFixture();
    beginNextPlayer(room, playersById, 1000);

    expect(placeBid(room, 't1', playersById, 2000).ok).toBe(true);
    const selfBid = placeBid(room, 't1', playersById, 3000);
    expect(selfBid.ok).toBe(false);
    expect(selfBid.error).toMatch(/highest bidder/i);

    expect(pauseAuction(room, 3000)).toBe(true);
    expect(placeBid(room, 't2', playersById, 4000).ok).toBe(false);
    expect(getBidState(room, 't2', playersById).error).toMatch(/paused/i);
  });

  it('resets the timer on every bid and freezes it while paused', () => {
    const { room, playersById } = makeFixture();
    beginNextPlayer(room, playersById, 1000);
    expect(computeRemaining(room.auction, 4000)).toBe(12000);

    placeBid(room, 't1', playersById, 4000);
    expect(computeRemaining(room.auction, 6000)).toBe(13000);

    expect(pauseAuction(room, 6000)).toBe(true);
    expect(computeRemaining(room.auction, 20000)).toBe(13000);
    expect(resumeAuction(room, 20000)).toBe(true);
    expect(computeRemaining(room.auction, 21000)).toBe(12000);
  });

  it('enforces purse, squad size, and overseas limits', () => {
    const { room, t1, playersById } = makeFixture();
    beginNextPlayer(room, playersById, 1000);

    t1.purseLakh = 100;
    expect(getBidState(room, t1.id, playersById).error).toMatch(/purse/i);

    t1.purseLakh = 12000;
    t1.squad = Array.from({ length: 25 }, (_, index) => ({ playerId: `x${index}`, priceLakh: 20 }));
    expect(getBidState(room, t1.id, playersById).error).toMatch(/squad is full/i);
  });
});

describe('lot shuffling', () => {
  it('shuffles the lot order into a fresh permutation', () => {
    const ids = Array.from({ length: 12 }, (_, index) => `p${index + 1}`);
    const shuffled = shuffleLots(ids);
    expect(shuffled).toHaveLength(ids.length);
    expect([...shuffled].sort()).toEqual([...ids].sort());
    expect(ids).toEqual([
      'p1', 'p2', 'p3', 'p4', 'p5', 'p6',
      'p7', 'p8', 'p9', 'p10', 'p11', 'p12',
    ]);
  });
});

describe('auction settlement', () => {
  it('sells the player to the leader and moves to the next player', () => {
    const { room, t1, playersById } = makeFixture();
    beginNextPlayer(room, playersById, 1000);
    placeBid(room, t1.id, playersById, 2000);
    placeBid(room, 't2', playersById, 3000);

    const result = settleCurrent(room, playersById, 4000);
    expect(result.kind).toBe('sold');
    expect(result.priceLakh).toBe(111);
    expect(t1.squad).toHaveLength(0);
    expect(room.teams.get('t2').purseLakh).toBe(12000 - 111);
    expect(room.teams.get('t2').squad).toEqual([{ playerId: 'p1', priceLakh: 111 }]);
    expect(room.auction.log).toHaveLength(1);

    const advanced = advanceAuction(room, playersById, 5000);
    expect(advanced.ended).toBe(false);
    expect(room.auction.index).toBe(1);
    expect(room.auction.current.playerId).toBe('p2');
  });

  it('marks an unsold player and can end the auction', () => {
    const { room, playersById } = makeFixture();
    beginNextPlayer(room, playersById, 1000);
    const result = settleCurrent(room, playersById, 2000);
    expect(result.kind).toBe('unsold');
    expect(room.auction.unsold).toEqual(['p1']);

    expect(endAuction(room, playersById)).toBe(true);
    expect(room.state).toBe('ended');
    expect(room.auction.phase).toBe('ended');
  });

  it('makes unauctioned lots available when the host ends early', () => {
    const { room, t1, t2, playersById } = makeFixture();
    t1.squad = Array.from({ length: 10 }, (_, index) => ({ playerId: `p${index + 1}`, priceLakh: 100 }));
    t2.squad = Array.from({ length: 10 }, (_, index) => ({ playerId: `p${index + 1}`, priceLakh: 100 }));
    beginNextPlayer(room, playersById, 1000);

    expect(endAuction(room, playersById)).toBe(true);
    expect(room.auction.unsold).toHaveLength(12);

    const result = fillSquads(room, playersById);
    expect(result.filled).toBe(2);
    expect(t1.squad).toHaveLength(11);
    expect(t2.squad).toHaveLength(11);
  });

  it('fills short squads from unsold players without duplicates', () => {
    const { room, t1, t2, playersById } = makeFixture();
    room.state = 'ended';
    room.auction.phase = 'ended';
    room.auction.unsold = ['p11', 'p12'];
    t1.squad = Array.from({ length: 10 }, (_, index) => ({ playerId: `p${index + 1}`, priceLakh: 100 }));
    t2.squad = Array.from({ length: 10 }, (_, index) => ({ playerId: `p${index + 1}`, priceLakh: 100 }));

    const result = fillSquads(room, playersById);
    expect(result.filled).toBe(2);
    expect(result.teams).toBe(2);
    expect(t1.squad).toHaveLength(11);
    expect(t2.squad).toHaveLength(11);
    expect(t1.squad.at(-1).playerId).not.toBe(t2.squad.at(-1).playerId);
    expect(room.auction.unsold).toHaveLength(0);
  });

  it('orders equal base prices by rating when filling', () => {
    const { room, t1, playersById } = makeFixture();
    room.state = 'ended';
    room.auction.phase = 'ended';
    room.auction.unsold = ['p11', 'p12'];
    playersById.get('p11').basePriceLakh = 100;
    playersById.get('p12').basePriceLakh = 100;
    playersById.get('p11').ratings.overall = 80;
    playersById.get('p12').ratings.overall = 60;
    t1.squad = Array.from({ length: 10 }, (_, index) => ({ playerId: `p${index + 1}`, priceLakh: 100 }));
    const t2 = room.teams.get('t2');
    t2.squad = Array.from({ length: 11 }, (_, index) => ({ playerId: `x${index + 1}`, priceLakh: 100 }));

    const result = fillSquads(room, playersById);
    expect(result.filled).toBe(1);
    expect(t1.squad.at(-1).playerId).toBe('p11');
  });

  it('does not fill with overseas players past the cap', () => {
    const { room, t1, t2, playersById } = makeFixture();
    room.state = 'ended';
    room.auction.phase = 'ended';
    room.auction.unsold = ['p11'];
    playersById.get('p11').overseas = true;
    t1.overseasCount = 8;
    t2.overseasCount = 8;
    t1.squad = Array.from({ length: 10 }, (_, index) => ({ playerId: `p${index + 1}`, priceLakh: 100 }));
    t2.squad = Array.from({ length: 10 }, (_, index) => ({ playerId: `p${index + 1}`, priceLakh: 100 }));

    const result = fillSquads(room, playersById);
    expect(result.filled).toBe(0);
    expect(t1.squad).toHaveLength(10);
  });
});
