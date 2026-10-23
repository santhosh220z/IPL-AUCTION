import crypto from 'node:crypto';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  COLOR_IDS,
  DEFAULT_TIMER_SEC,
  MAX_OVERSEAS,
  MAX_SQUAD,
  MAX_TEAMS,
  PURSE_LAKH,
  normalizeTeamName,
} from '../shared/constants.js';
import { computeRemaining } from './auction.js';

export const rooms = new Map();

const TEAM_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 .'&_-]*$/;

function randomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function uniqueCode() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const code = randomCode();
    if (!rooms.has(code)) return code;
  }
  throw new Error('Could not allocate a room code.');
}

function normalizeName(name) {
  return normalizeTeamName(name).toLowerCase();
}

export function validateTeamName(raw) {
  const name = normalizeTeamName(raw);
  if (name.length < 2 || name.length > 24) return { ok: false, error: 'Team name must be 2-24 characters.' };
  if (!TEAM_NAME_RE.test(name)) {
    return { ok: false, error: 'Team name can use letters, numbers, spaces, . _ & - and apostrophes.' };
  }
  return { ok: true, name };
}

export function validateColor(raw) {
  if (!COLOR_IDS.includes(raw)) return { ok: false, error: 'Pick one of the available accent colors.' };
  return { ok: true, color: raw };
}

export function getRoom(code) {
  return rooms.get(String(code ?? '').trim().toUpperCase()) ?? null;
}

export function teamNameTaken(room, name) {
  const key = normalizeName(name);
  return [...room.teams.values()].some((team) => normalizeName(team.teamName) === key);
}

export function colorTaken(room, color) {
  return [...room.teams.values()].some((team) => team.color === color);
}

export function createRoom({ teamName, color }) {
  const nameCheck = validateTeamName(teamName);
  if (!nameCheck.ok) return nameCheck;
  const colorCheck = validateColor(color);
  if (!colorCheck.ok) return colorCheck;

  const code = uniqueCode();
  const room = {
    code,
    hostId: null,
    state: 'lobby',
    teams: new Map(),
    auction: null,
    simulation: null,
    settings: { timerSec: DEFAULT_TIMER_SEC },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    timers: { tick: null, phase: null, hostTransfer: null },
  };

  const team = addTeam(room, nameCheck.name, colorCheck.color);
  room.hostId = team.id;
  rooms.set(code, room);
  return { ok: true, room, team };
}

export function addTeam(room, teamName, color) {
  const team = {
    id: crypto.randomUUID(),
    token: crypto.randomBytes(18).toString('base64url'),
    socketId: null,
    teamName,
    color,
    connected: false,
    joinedAt: Date.now(),
    purseLakh: PURSE_LAKH,
    squad: [],
    overseasCount: 0,
    lastBidAt: 0,
  };
  room.teams.set(team.id, team);
  touch(room);
  return team;
}

export function joinRoom(room, { teamName, color }) {
  if (room.state !== 'lobby') return { ok: false, error: 'This room has already started.' };
  if (room.teams.size >= MAX_TEAMS) return { ok: false, error: 'This room is full.' };

  const nameCheck = validateTeamName(teamName);
  if (!nameCheck.ok) return nameCheck;
  const colorCheck = validateColor(color);
  if (!colorCheck.ok) return colorCheck;
  if (teamNameTaken(room, nameCheck.name)) return { ok: false, error: 'That team name is already taken.' };
  if (colorTaken(room, colorCheck.color)) return { ok: false, error: 'That accent color is already taken.' };

  const team = addTeam(room, nameCheck.name, colorCheck.color);
  return { ok: true, team };
}

export function findTeamByToken(room, token) {
  if (!token) return null;
  return [...room.teams.values()].find((team) => team.token === token) ?? null;
}

export function removeTeam(room, teamId) {
  const team = room.teams.get(teamId);
  if (!team) return false;
  room.teams.delete(teamId);
  touch(room);

  if (room.hostId === teamId) {
    const next = [...room.teams.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    room.hostId = next?.id ?? null;
  }

  if (room.teams.size === 0) {
    clearRoomTimers(room);
    rooms.delete(room.code);
  }
  return true;
}

export function promoteHost(room) {
  const connected = [...room.teams.values()]
    .filter((team) => team.connected)
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const next = connected[0] ?? [...room.teams.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
  if (!next) return null;
  room.hostId = next.id;
  touch(room);
  return next;
}

export function clearRoomTimers(room) {
  if (!room?.timers) return;
  for (const key of ['tick', 'phase', 'hostTransfer']) {
    if (room.timers[key]) {
      clearTimeout(room.timers[key]);
      clearInterval(room.timers[key]);
      room.timers[key] = null;
    }
  }
}

export function touch(room) {
  room.updatedAt = Date.now();
}

export function previewRoom(room) {
  return {
    code: room.code,
    state: room.state,
    hostTeamName: room.teams.get(room.hostId)?.teamName ?? null,
    playerCount: room.teams.size,
    maxTeams: MAX_TEAMS,
    timerSec: room.settings.timerSec,
    takenNames: [...room.teams.values()].map((team) => team.teamName),
    takenColors: [...room.teams.values()].map((team) => team.color),
  };
}

function playerSummary(player) {
  if (!player) return null;
  return {
    id: player.id,
    name: player.name,
    role: player.role,
    overseas: player.overseas,
    team: player.team,
    teamName: player.teamName,
    basePriceLakh: player.basePriceLakh,
    set: player.set,
    ratings: player.ratings,
  };
}

function teamSummary(team) {
  return {
    id: team.id,
    teamName: team.teamName,
    color: team.color,
    connected: team.connected,
  };
}

function squadEntry(entry, playersById) {
  const player = playersById.get(entry.playerId);
  if (!player) return null;
  return {
    playerId: player.id,
    name: player.name,
    role: player.role,
    overseas: player.overseas,
    priceLakh: entry.priceLakh,
    overall: player.ratings.overall,
    basePriceLakh: player.basePriceLakh,
  };
}

function enrichEvent(event, room, playersById) {
  if (!event) return null;
  return {
    id: event.id,
    type: event.type,
    player: playerSummary(playersById.get(event.playerId)),
    team: event.teamId ? teamSummary(room.teams.get(event.teamId)) : null,
    priceLakh: event.priceLakh,
    at: event.at,
  };
}

export function snapshotRoom(room, playersById, viewerId) {
  const auction = room.auction;
  const current = auction?.current;
  const currentPlayer = current ? playersById.get(current.playerId) : null;
  const teams = [...room.teams.values()]
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((team) => ({
      ...teamSummary(team),
      isHost: team.id === room.hostId,
      purseLakh: team.purseLakh,
      squadCount: team.squad.length,
      overseasCount: team.overseasCount,
      squad: team.squad.map((entry) => squadEntry(entry, playersById)).filter(Boolean),
    }));

  return {
    type: 'room:snapshot',
    code: room.code,
    state: room.state,
    hostId: room.hostId,
    youId: viewerId,
    serverNow: Date.now(),
    settings: {
      timerSec: room.settings.timerSec,
      purseLakh: PURSE_LAKH,
      maxSquad: MAX_SQUAD,
      maxOverseas: MAX_OVERSEAS,
      maxTeams: MAX_TEAMS,
    },
    teams,
    auction: auction
      ? {
          phase: auction.phase,
          paused: auction.paused,
          timerSec: auction.timerSec,
          remainingMs: computeRemaining(auction),
          index: auction.index,
          totalCount: auction.totalCount,
          queueRemaining: Math.max(0, auction.totalCount - auction.index - (current ? 1 : 0)),
          soldCount: auction.soldCount,
          unsoldCount: auction.unsold.length,
          current: current
            ? {
                player: playerSummary(currentPlayer),
                stats: currentPlayer?.stats ?? null,
                basePriceLakh: current.basePriceLakh,
                currentBidLakh: current.currentBidLakh,
                leaderId: current.leaderId,
                leaderTeam: current.leaderId ? teamSummary(room.teams.get(current.leaderId)) : null,
                status: current.status,
                bidCount: current.bidCount,
              }
            : null,
          lastEvent: enrichEvent(auction.lastEvent, room, playersById),
          log: auction.log.slice(-20).map((event) => enrichEvent(event, room, playersById)),
          unsoldPlayers:
            room.state === 'ended'
              ? auction.unsold
                  .map((playerId) => playerSummary(playersById.get(playerId)))
                  .filter(Boolean)
              : undefined,
        }
      : null,
    simulation: room.simulation,
  };
}
