import { describe, expect, it } from 'vitest';
import {
  advanceAuction,
  beginNextPlayer,
  computeRemaining,
  createAuctionState,
  endAuction,
  fillSquads,
  getBidState,
  pauseAuction,
  placeBid,
  resumeAuction,
  settleCurrent,
  shuffleLots,
} from '../auction.js';
import { BID_RAISE_LAKH } from '../../shared/constants.js';

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

describe('bid raises', () => {
  it('bids the base price first and then offers fixed raises over the bid', () => {
    expect(BID_RAISE_LAKH).toEqual([1, 25, 50, 100]);

    const { room, t1, playersById } = makeFixture();
    beginNextPlayer(room, playersById, 1000);
    expect(getBidState(room, t1.id, playersById, 1).amount).toBe(101);
    expect(placeBid(room, t1.id, playersById, 25, 2000).ok).toBe(true);
    expect(room.auction.current.currentBidLakh).toBe(101);
    expect(room.auction.current.leaderId).toBe('t1');

    expect(getBidState(room, 't2', playersById, 1).amount).toBe(102);
    expect(getBidState(room, 't2', playersById, 25).amount).toBe(126);
    expect(getBidState(room, 't2', playersById, 50).amount).toBe(151);
    expect(getBidState(room, 't2', playersById, 100).amount).toBe(201);
  });

  it('rejects raise amounts outside the fixed set', () => {
    const { room, t1, playersById } = makeFixture();
    beginNextPlayer(room, playersById, 1000);
    expect(placeBid(room, t1.id, playersById, 1, 2000).ok).toBe(true);

    expect(getBidState(room, 't2', playersById, 7).error).toMatch(/valid raise/i);
    expect(placeBid(room, 't2', playersById, 7, 3000).ok).toBe(false);
  });

  it('rejects raises the purse cannot afford while smaller raises still work', () => {
    const { room, t1, playersById } = makeFixture();
    beginNextPlayer(room, playersById, 1000);
    expect(placeBid(room, t1.id, playersById, 100, 2000).ok).toBe(true);
    expect(room.auction.current.currentBidLakh).toBe(101);

    const t2 = room.teams.get('t2');
    t2.purseLakh = 125;
    expect(getBidState(room, 't2', playersById, 25).error).toMatch(/purse/i);
    expect(getBidState(room, 't2', playersById, 1).ok).toBe(true);
    expect(placeBid(room, 't2', playersById, 1, 3000).ok).toBe(true);
  });
});

describe('auction bidding', () => {
  it('rejects self-outbids and bids from a paused auction', () => {
    const { room, playersById } = makeFixture();
    beginNextPlayer(room, playersById, 1000);

    expect(placeBid(room, 't1', playersById, 1, 2000).ok).toBe(true);
    const selfBid = placeBid(room, 't1', playersById, 1, 3000);
    expect(selfBid.ok).toBe(false);
    expect(selfBid.error).toMatch(/highest bidder/i);

    expect(pauseAuction(room, 3000)).toBe(true);
    expect(placeBid(room, 't2', playersById, 1, 4000).ok).toBe(false);
    expect(getBidState(room, 't2', playersById, 1).error).toMatch(/paused/i);
  });

  it('resets the timer on every bid and freezes it while paused', () => {
    const { room, playersById } = makeFixture();
    beginNextPlayer(room, playersById, 1000);
    expect(computeRemaining(room.auction, 4000)).toBe(12000);

    placeBid(room, 't1', playersById, 1, 4000);
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
    expect(getBidState(room, t1.id, playersById, 1).error).toMatch(/purse/i);

    t1.purseLakh = 12000;
    t1.squad = Array.from({ length: 25 }, (_, index) => ({ playerId: `x${index}`, priceLakh: 20 }));
    expect(getBidState(room, t1.id, playersById, 1).error).toMatch(/squad is full/i);
  });

  it('blocks bids from a team that voted to skip the current player', () => {
    const { room, t1, t2, playersById } = makeFixture();
    beginNextPlayer(room, playersById, 1000);

    room.auction.skipVotes.set(t1.id, new Set([room.auction.current.playerId]));
    const bidState = getBidState(room, t1.id, playersById, 1);
    expect(bidState.ok).toBe(false);
    expect(bidState.error).toMatch(/voted to skip/i);

    expect(getBidState(room, t2.id, playersById, 1).ok).toBe(true);
  });

  it('settles as unsold when all teams skip and clears skip votes on advance', () => {
    const { room, t1, t2, playersById } = makeFixture();
    beginNextPlayer(room, playersById, 1000);
    const p1Id = room.auction.current.playerId;

    room.auction.skipVotes.set(t1.id, new Set([p1Id]));
    room.auction.skipVotes.set(t2.id, new Set([p1Id]));

    const result = settleCurrent(room, playersById, 2000);
    expect(result.kind).toBe('unsold');
    expect(room.auction.phase).toBe('unsold');
    expect(room.auction.unsold).toContain(p1Id);

    const advanced = advanceAuction(room, playersById, 3000);
    expect(advanced.ended).toBe(false);
    expect(room.auction.current.playerId).not.toBe(p1Id);
    expect(room.auction.skipVotes.size).toBe(0);
    expect(getBidState(room, t1.id, playersById, 1).ok).toBe(true);
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
    placeBid(room, t1.id, playersById, 1, 2000);
    placeBid(room, 't2', playersById, 25, 3000);

    const result = settleCurrent(room, playersById, 4000);
    expect(result.kind).toBe('sold');
    expect(result.priceLakh).toBe(126);
    expect(t1.squad).toHaveLength(0);
    expect(room.teams.get('t2').purseLakh).toBe(12000 - 126);
    expect(room.teams.get('t2').squad).toEqual([{ playerId: 'p1', priceLakh: 126 }]);
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

  it('does not hand out free pickups and reports teams that stay below 11', () => {
    const { room, t1, t2, playersById } = makeFixture();
    room.state = 'ended';
    room.auction.phase = 'ended';
    room.auction.unsold = ['p11', 'p12', 'p1'];
    t1.purseLakh = 99;
    t1.squad = Array.from({ length: 10 }, (_, index) => ({ playerId: `x${index + 1}`, priceLakh: 100 }));
    t2.squad = Array.from({ length: 10 }, (_, index) => ({ playerId: `y${index + 1}`, priceLakh: 100 }));

    const result = fillSquads(room, playersById);
    expect(result.filled).toBe(1);
    expect(t1.squad).toHaveLength(10);
    expect(t1.purseLakh).toBe(99);
    expect(result.shortTeams).toEqual([t1.id]);
    expect(t2.squad).toHaveLength(11);
  });

  it('goes home short instead of discounting players below base price', () => {
    const { room, t1, t2, playersById } = makeFixture();
    room.state = 'ended';
    room.auction.phase = 'ended';
    room.auction.unsold = ['p11', 'p12'];
    t1.purseLakh = 100;
    t2.purseLakh = 100;
    t1.squad = Array.from({ length: 10 }, (_, index) => ({ playerId: `x${index + 1}`, priceLakh: 100 }));
    t2.squad = Array.from({ length: 10 }, (_, index) => ({ playerId: `y${index + 1}`, priceLakh: 100 }));

    // Base prices are 101-112: nothing is affordable. No transfer at a discount.
    const result = fillSquads(room, playersById);
    expect(result.filled).toBe(0);
    expect(t1.squad).toHaveLength(10);
    expect(t1.purseLakh).toBe(100);
    expect(result.shortTeams).toEqual([t1.id, t2.id]);
  });

  it('still fills squads that can afford base price', () => {
    const { room, t1, t2, playersById } = makeFixture();
    room.state = 'ended';
    room.auction.phase = 'ended';
    room.auction.unsold = ['p11', 'p12'];
    t1.squad = Array.from({ length: 10 }, (_, index) => ({ playerId: `x${index + 1}`, priceLakh: 100 }));
    t2.squad = Array.from({ length: 10 }, (_, index) => ({ playerId: `y${index + 1}`, priceLakh: 100 }));

    const result = fillSquads(room, playersById);
    expect(result.filled).toBe(2);
    expect(result.shortTeams).toEqual([]);
    expect(t1.squad).toHaveLength(11);
    expect(t2.squad).toHaveLength(11);
    // Each purchase costs exactly the base price.
    const b1 = playersById.get(t1.squad.at(-1).playerId).basePriceLakh;
    expect(t1.purseLakh).toBe(12000 - b1);
  });
});
