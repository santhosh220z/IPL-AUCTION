import {
  MAX_OVERSEAS,
  MAX_SQUAD,
  bidIncrementLakh,
} from '../shared/constants.js';

export function createAuctionState(playerIds, timerSec) {
  return {
    queue: [...playerIds],
    index: 0,
    current: null,
    phase: 'idle',
    paused: false,
    timerSec,
    remainingMs: timerSec * 1000,
    deadline: 0,
    lastEvent: null,
    log: [],
    unsold: [],
    soldCount: 0,
    totalCount: playerIds.length,
  };
}

export function nextBidFor(auction) {
  if (!auction?.current) return null;
  const current = auction.current;
  if (!current.leaderId) return current.basePriceLakh;
  return current.currentBidLakh + bidIncrementLakh(current.currentBidLakh);
}

export function beginNextPlayer(room, playersById, now = Date.now()) {
  const auction = room.auction;
  if (!auction) return null;
  if (auction.index >= auction.queue.length) {
    auction.current = null;
    auction.phase = 'ended';
    room.state = 'ended';
    auction.remainingMs = 0;
    auction.deadline = 0;
    return null;
  }

  const playerId = auction.queue[auction.index];
  const player = playersById.get(playerId);
  if (!player) {
    auction.index += 1;
    return beginNextPlayer(room, playersById, now);
  }

  auction.current = {
    playerId,
    basePriceLakh: player.basePriceLakh,
    currentBidLakh: player.basePriceLakh,
    leaderId: null,
    status: 'open',
    bidCount: 0,
    deadline: now + auction.timerSec * 1000,
    startedAt: now,
  };
  auction.phase = 'open';
  auction.paused = false;
  auction.remainingMs = auction.timerSec * 1000;
  auction.deadline = auction.current.deadline;
  return auction.current;
}

export function getBidState(room, teamId, playersById) {
  const auction = room.auction;
  if (!auction || room.state !== 'auction') return { ok: false, error: 'Auction is not running.' };
  if (!auction.current || auction.current.status !== 'open' || auction.phase !== 'open') {
    return { ok: false, error: 'No player is currently on the block.' };
  }
  if (auction.paused) return { ok: false, error: 'The auction is paused.' };

  const team = room.teams.get(teamId);
  if (!team) return { ok: false, error: 'Team not found.' };
  const player = playersById.get(auction.current.playerId);
  if (!player) return { ok: false, error: 'Player not found.' };
  if (auction.current.leaderId === teamId) return { ok: false, error: 'You are already the highest bidder.' };

  const amount = nextBidFor(auction);
  if (team.purseLakh < amount) return { ok: false, error: 'Not enough purse for this bid.' };
  if (team.squad.length >= MAX_SQUAD) return { ok: false, error: `Squad is full (${MAX_SQUAD}).` };
  if (player.overseas && team.overseasCount >= MAX_OVERSEAS) {
    return { ok: false, error: `Overseas limit reached (${MAX_OVERSEAS}).` };
  }

  return { ok: true, amount, team, player };
}

export function placeBid(room, teamId, playersById, now = Date.now()) {
  const check = getBidState(room, teamId, playersById);
  if (!check.ok) return check;

  const auction = room.auction;
  const current = auction.current;
  current.leaderId = teamId;
  current.currentBidLakh = check.amount;
  current.bidCount += 1;
  current.deadline = now + auction.timerSec * 1000;
  auction.deadline = current.deadline;
  auction.remainingMs = auction.timerSec * 1000;
  auction.paused = false;
  auction.lastEvent = {
    id: `${current.playerId}:${current.bidCount}:${now}`,
    type: 'bid',
    playerId: current.playerId,
    teamId,
    priceLakh: check.amount,
    at: now,
  };
  return { ok: true, amount: check.amount, player: check.player, team: check.team };
}

export function settleCurrent(room, playersById, now = Date.now(), options = {}) {
  const auction = room.auction;
  if (!auction || !auction.current || auction.current.status !== 'open' || auction.phase !== 'open') {
    return null;
  }

  const current = auction.current;
  const player = playersById.get(current.playerId);
  const forceUnsold = Boolean(options.forceUnsold);
  const leader = !forceUnsold && current.leaderId ? room.teams.get(current.leaderId) : null;

  if (leader && player) {
    const price = current.currentBidLakh;
    leader.purseLakh -= price;
    leader.squad.push({ playerId: player.id, priceLakh: price });
    if (player.overseas) leader.overseasCount += 1;
    auction.soldCount += 1;
    const event = {
      id: `${player.id}:sold:${now}`,
      type: 'sold',
      playerId: player.id,
      teamId: leader.id,
      priceLakh: price,
      at: now,
    };
    auction.log.push(event);
    auction.lastEvent = event;
    current.status = 'sold';
    auction.phase = 'sold';
    auction.paused = false;
    auction.remainingMs = 0;
    auction.deadline = 0;
    return { kind: 'sold', event, player, team: leader, priceLakh: price, waitMs: 2600 };
  }

  if (player) {
    auction.unsold.push(player.id);
    const event = {
      id: `${player.id}:unsold:${now}`,
      type: 'unsold',
      playerId: player.id,
      teamId: null,
      priceLakh: null,
      at: now,
    };
    auction.log.push(event);
    auction.lastEvent = event;
    current.status = 'unsold';
    auction.phase = 'unsold';
    auction.paused = false;
    auction.remainingMs = 0;
    auction.deadline = 0;
    return { kind: 'unsold', event, player, waitMs: 1300 };
  }

  return null;
}

export function advanceAuction(room, playersById, now = Date.now()) {
  const auction = room.auction;
  if (!auction) return null;
  auction.index += 1;
  if (auction.index >= auction.queue.length) {
    auction.current = null;
    auction.phase = 'ended';
    auction.paused = false;
    auction.remainingMs = 0;
    auction.deadline = 0;
    room.state = 'ended';
    return { ended: true };
  }
  const current = beginNextPlayer(room, playersById, now);
  return { ended: false, current };
}

export function pauseAuction(room, now = Date.now()) {
  const auction = room.auction;
  if (!auction || auction.phase !== 'open' || auction.paused) return false;
  auction.remainingMs = Math.max(0, auction.deadline - now);
  auction.deadline = 0;
  auction.paused = true;
  return true;
}

export function resumeAuction(room, now = Date.now()) {
  const auction = room.auction;
  if (!auction || auction.phase !== 'open' || !auction.paused) return false;
  auction.deadline = now + auction.remainingMs;
  auction.paused = false;
  return true;
}

export function endAuction(room, playersById) {
  const auction = room.auction;
  if (!auction || room.state === 'ended') return false;
  const currentSold = auction.current?.status === 'sold';
  if (auction.current && auction.current.status === 'open') {
    auction.current.status = 'skipped';
  }
  const unsold = new Set(auction.unsold);
  const remainingStart = currentSold ? auction.index + 1 : auction.index;
  for (const playerId of auction.queue.slice(remainingStart)) {
    if (!unsold.has(playerId)) {
      auction.unsold.push(playerId);
      unsold.add(playerId);
    }
  }
  auction.current = null;
  room.state = 'ended';
  auction.phase = 'ended';
  auction.paused = false;
  auction.remainingMs = 0;
  auction.deadline = 0;
  void playersById;
  return true;
}

export function fillSquads(room, playersById) {
  const auction = room.auction;
  if (!auction || room.state !== 'ended') return { filled: 0, teams: 0 };

  const taken = new Set();
  for (const team of room.teams.values()) {
    for (const entry of team.squad) taken.add(entry.playerId);
  }

  const available = auction.unsold
    .filter((playerId) => !taken.has(playerId) && playersById.has(playerId))
    .filter((playerId) => {
      const player = playersById.get(playerId);
      return player && !taken.has(player.id);
    })
    .sort((a, b) => {
      const pa = playersById.get(a);
      const pb = playersById.get(b);
      return pa.basePriceLakh - pb.basePriceLakh || pb.ratings.overall - pa.ratings.overall;
    });

  let filled = 0;
  let teamsTouched = 0;

  for (const team of room.teams.values()) {
    if (team.squad.length >= 11) continue;
    let touched = false;
    const usedIds = new Set();

    while (team.squad.length < 11) {
      const candidate = available.find((playerId) => {
        if (usedIds.has(playerId) || taken.has(playerId)) return false;
        const player = playersById.get(playerId);
        if (!player) return false;
        if (player.overseas && team.overseasCount >= MAX_OVERSEAS) return false;
        return true;
      });
      if (!candidate) break;

      const player = playersById.get(candidate);
      const price = Math.min(player.basePriceLakh, Math.max(0, team.purseLakh));
      usedIds.add(candidate);
      team.purseLakh -= price;
      team.squad.push({ playerId: player.id, priceLakh: price });
      if (player.overseas) team.overseasCount += 1;
      taken.add(player.id);
      filled += 1;
      touched = true;
    }

    if (touched) teamsTouched += 1;
  }

  auction.unsold = auction.unsold.filter((playerId) => !taken.has(playerId));
  return { filled, teams: teamsTouched };
}

export function computeRemaining(auction, now = Date.now()) {
  if (!auction) return 0;
  if (auction.paused) return Math.max(0, auction.remainingMs);
  if (auction.current?.status !== 'open') return 0;
  return Math.max(0, auction.deadline - now);
}
