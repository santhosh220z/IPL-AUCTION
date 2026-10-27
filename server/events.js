import fs from 'node:fs';
import {
  HOST_TRANSFER_MS,
  MIN_PLAYERS_TO_START,
  ROOM_IDLE_MS,
  TIMER_OPTIONS,
  parseSeed,
} from '../shared/constants.js';
import {
  advanceAuction,
  beginNextPlayer,
  computeRemaining,
  createAuctionState,
  endAuction,
  fillSquads,
  pauseAuction,
  placeBid,
  resumeAuction,
  settleCurrent,
  shuffleLots,
} from './auction.js';
import {
  clearRoomTimers,
  createRoom,
  findTeamByToken,
  getRoom,
  joinRoom,
  previewRoom,
  promoteHost,
  removeTeam,
  rooms,
  snapshotRoom,
  touch,
} from './rooms.js';
import { simulateTournament } from './simulation.js';

const data = JSON.parse(fs.readFileSync(new URL('../all_players.json', import.meta.url), 'utf8'));
const playersById = new Map(data.players.map((player) => [player.id, player]));
const playerIds = data.players.map((player) => player.id);

function reply(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

function payloadOf(value) {
  return value && typeof value === 'object' ? value : {};
}

export function registerSocketHandlers(io) {
  function contextFor(socket) {
    const room = getRoom(socket.data.roomCode);
    const team = room?.teams.get(socket.data.teamId);
    return { room, team };
  }

  function hostContextFor(socket) {
    const context = contextFor(socket);
    if (!context.room || !context.team) return { error: 'You are not in a room.' };
    if (context.room.hostId !== context.team.id) return { error: 'Only the host can do that.' };
    return context;
  }

  function broadcastRoom(room) {
    if (!rooms.has(room.code)) return;
    for (const team of room.teams.values()) {
      if (!team.socketId) continue;
      io.to(team.socketId).emit('room:snapshot', snapshotRoom(room, playersById, team.id));
    }
  }

  function clearSocketData(socket) {
    socket.data.roomCode = null;
    socket.data.teamId = null;
  }

  function scheduleHostTransfer(room) {
    if (!room || room.state === 'ended' || !rooms.has(room.code)) return;
    clearTimeout(room.timers.hostTransfer);
    room.timers.hostTransfer = setTimeout(() => {
      room.timers.hostTransfer = null;
      if (!rooms.has(room.code)) return;
      if (room.teams.get(room.hostId)?.connected) return;
      const someoneOnline = [...room.teams.values()].some((team) => team.connected);
      if (!someoneOnline) return;
      promoteHost(room);
      touch(room);
      broadcastRoom(room);
    }, HOST_TRANSFER_MS);
  }

  function detachSocket(socket, { removeLobbyTeam = false } = {}) {
    const { room, team } = contextFor(socket);
    if (!room || !team) {
      clearSocketData(socket);
      return;
    }

    socket.leave(room.code);
    if (team.socketId === socket.id) {
      team.socketId = null;
      team.connected = false;
    }

    if (removeLobbyTeam && room.state === 'lobby') {
      removeTeam(room, team.id);
    }

    if (rooms.has(room.code)) {
      if (!team.connected && room.hostId === team.id) scheduleHostTransfer(room);
      broadcastRoom(room);
    }
    clearSocketData(socket);
  }

  function attachSocket(socket, room, team) {
    const previous = contextFor(socket);
    if (previous.room && previous.team && (previous.room.code !== room.code || previous.team.id !== team.id)) {
      detachSocket(socket, { removeLobbyTeam: true });
    }

    const oldSocketId = team.socketId;
    team.socketId = socket.id;
    team.connected = true;

    if (oldSocketId && oldSocketId !== socket.id) {
      const oldSocket = io.sockets.sockets.get(oldSocketId);
      oldSocket?.disconnect(true);
    }

    socket.data.roomCode = room.code;
    socket.data.teamId = team.id;
    socket.join(room.code);

    if (room.hostId === team.id && room.timers.hostTransfer) {
      clearTimeout(room.timers.hostTransfer);
      room.timers.hostTransfer = null;
    }
    touch(room);
  }

  function stopAuctionTimers(room) {
    if (room.timers.tick) {
      clearInterval(room.timers.tick);
      room.timers.tick = null;
    }
    if (room.timers.phase) {
      clearTimeout(room.timers.phase);
      room.timers.phase = null;
    }
  }

  function finishAuction(room) {
    if (!rooms.has(room.code)) return;
    room.state = 'ended';
    if (room.auction) {
      room.auction.phase = 'ended';
      room.auction.paused = false;
      room.auction.remainingMs = 0;
      room.auction.deadline = 0;
    }
    stopAuctionTimers(room);
    touch(room);
    broadcastRoom(room);
  }

  function scheduleAdvance(room, waitMs) {
    if (room.timers.phase) clearTimeout(room.timers.phase);
    broadcastRoom(room);

    room.timers.phase = setTimeout(() => {
      room.timers.phase = null;
      if (!rooms.has(room.code) || room.state !== 'auction') return;
      const advanced = advanceAuction(room, playersById);
      if (!advanced || advanced.ended) {
        finishAuction(room);
        return;
      }
      touch(room);
      broadcastRoom(room);
    }, waitMs);
  }

  function startAuctionTicker(room) {
    stopAuctionTimers(room);
    room.timers.tick = setInterval(() => {
      if (!rooms.has(room.code) || room.state !== 'auction' || !room.auction) return;
      const auction = room.auction;
      if (auction.phase !== 'open') return;

      const remainingMs = computeRemaining(auction);
      io.to(room.code).emit('auction:timer', {
        remainingMs,
        paused: auction.paused,
        serverNow: Date.now(),
      });

      if (!auction.paused && remainingMs <= 0) {
        const result = settleCurrent(room, playersById);
        if (result) scheduleAdvance(room, result.waitMs);
      }
    }, 500);
  }

  function attachAndAck(socket, room, team, ack, extra = {}) {
    attachSocket(socket, room, team);
    broadcastRoom(room);
    reply(ack, {
      ok: true,
      code: room.code,
      token: team.token,
      teamId: team.id,
      snapshot: snapshotRoom(room, playersById, team.id),
      ...extra,
    });
  }

  io.on('connection', (socket) => {
  socket.on('room:create', (rawPayload, ack) => {
    const payload = payloadOf(rawPayload);
    const result = createRoom({ teamName: payload.teamName, color: payload.color });
    if (!result.ok) {
      reply(ack, result);
      return;
    }
    attachAndAck(socket, result.room, result.team, ack);
  });

  socket.on('room:join', (rawPayload, ack) => {
    const payload = payloadOf(rawPayload);
    const room = getRoom(payload.code);
    if (!room) {
      reply(ack, { ok: false, error: 'Room not found.' });
      return;
    }
    const result = joinRoom(room, { teamName: payload.teamName, color: payload.color });
    if (!result.ok) {
      reply(ack, result);
      return;
    }
    attachAndAck(socket, room, result.team, ack);
  });

  socket.on('room:rejoin', (rawPayload, ack) => {
    const payload = payloadOf(rawPayload);
    const room = getRoom(payload.code);
    if (!room) {
      reply(ack, { ok: false, error: 'Room no longer exists.' });
      return;
    }
    const team = findTeamByToken(room, payload.token);
    if (!team) {
      reply(ack, { ok: false, error: 'Could not restore your team.' });
      return;
    }
    attachAndAck(socket, room, team, ack, { reconnected: true });
  });

  socket.on('room:preview', (rawPayload, ack) => {
    const payload = payloadOf(rawPayload);
    const room = getRoom(payload.code);
    if (!room) {
      reply(ack, { ok: false, error: 'Room not found.' });
      return;
    }
    reply(ack, { ok: true, preview: previewRoom(room) });
  });

  socket.on('room:sync', (rawPayload, ack) => {
    const { room, team } = contextFor(socket);
    if (!room || !team) {
      reply(ack, { ok: false, error: 'You are not in a room.' });
      return;
    }
    reply(ack, { ok: true, snapshot: snapshotRoom(room, playersById, team.id) });
  });

  socket.on('room:leave', (_rawPayload, ack) => {
    detachSocket(socket, { removeLobbyTeam: true });
    reply(ack, { ok: true });
  });

  socket.on('settings:update', (rawPayload, ack) => {
    const payload = payloadOf(rawPayload);
    const context = hostContextFor(socket);
    if (context.error) {
      reply(ack, { ok: false, error: context.error });
      return;
    }
    const { room } = context;
    if (room.state !== 'lobby') {
      reply(ack, { ok: false, error: 'Settings are locked after the auction starts.' });
      return;
    }
    const timerSec = Number(payload.timerSec);
    if (!TIMER_OPTIONS.includes(timerSec)) {
      reply(ack, { ok: false, error: 'Choose a valid timer.' });
      return;
    }
    room.settings.timerSec = timerSec;
    touch(room);
    broadcastRoom(room);
    reply(ack, { ok: true });
  });

  socket.on('auction:start', (_rawPayload, ack) => {
    const context = hostContextFor(socket);
    if (context.error) {
      reply(ack, { ok: false, error: context.error });
      return;
    }
    const { room } = context;
    if (room.state !== 'lobby') {
      reply(ack, { ok: false, error: 'The auction has already started.' });
      return;
    }
    if (room.teams.size < MIN_PLAYERS_TO_START) {
      reply(ack, { ok: false, error: 'At least two teams are needed.' });
      return;
    }

    stopAuctionTimers(room);
    room.state = 'auction';
    room.simulation = null;
    room.auction = createAuctionState(shuffleLots(playerIds), room.settings.timerSec);
    beginNextPlayer(room, playersById);
    touch(room);
    startAuctionTicker(room);
    broadcastRoom(room);
    reply(ack, { ok: true });
  });

  socket.on('auction:bid', (rawPayload, ack) => {
    const payload = payloadOf(rawPayload);
    const { room, team } = contextFor(socket);
    if (!room || !team) {
      reply(ack, { ok: false, error: 'You are not in a room.' });
      return;
    }
    if (room.state !== 'auction') {
      reply(ack, { ok: false, error: 'The auction is not running.' });
      return;
    }
    const result = placeBid(room, team.id, playersById, payload.raiseLakh);
    if (!result.ok) {
      reply(ack, result);
      return;
    }
    touch(room);
    broadcastRoom(room);
    reply(ack, { ok: true, amount: result.amount });
  });

  socket.on('auction:pause', (_rawPayload, ack) => {
    const context = hostContextFor(socket);
    if (context.error) {
      reply(ack, { ok: false, error: context.error });
      return;
    }
    if (!pauseAuction(context.room)) {
      reply(ack, { ok: false, error: 'There is no open lot to pause.' });
      return;
    }
    touch(context.room);
    broadcastRoom(context.room);
    reply(ack, { ok: true });
  });

  socket.on('auction:resume', (_rawPayload, ack) => {
    const context = hostContextFor(socket);
    if (context.error) {
      reply(ack, { ok: false, error: context.error });
      return;
    }
    if (!resumeAuction(context.room)) {
      reply(ack, { ok: false, error: 'The auction is not paused.' });
      return;
    }
    touch(context.room);
    broadcastRoom(context.room);
    reply(ack, { ok: true });
  });

  socket.on('auction:skip', (rawPayload, ack) => {
    const payload = payloadOf(rawPayload);
    let { room, team } = contextFor(socket);
    if (!room && payload.code) {
      room = getRoom(payload.code);
    }
    if (!team && room) {
      team = room.teams.get(socket.data.teamId);
    }
    if (!room || !team) {
      reply(ack, { ok: false, error: 'You are not in a room.' });
      return;
    }
    if (room.state !== 'auction') {
      reply(ack, { ok: false, error: 'The auction is not running.' });
      return;
    }

    const auction = room.auction;
    if (!auction || auction.current?.status !== 'open' || auction.phase !== 'open') {
      reply(ack, { ok: false, error: 'No player is currently on the block.' });
      return;
    }
    if (auction.paused) {
      reply(ack, { ok: false, error: 'The auction is paused.' });
      return;
    }
    if (auction.current.leaderId === team.id) {
      reply(ack, { ok: false, error: 'You cannot skip a player you hold the highest bid on.' });
      return;
    }

    // Record this team's skip vote for the current player
    if (!auction.skipVotes.has(team.id)) {
      auction.skipVotes.set(team.id, new Set());
    }
    auction.skipVotes.get(team.id).add(auction.current.playerId);

    // Check if all teams have voted to skip
    const allSkipped = [...room.teams.values()].every((t) => {
      return auction.skipVotes.has(t.id) && auction.skipVotes.get(t.id).has(auction.current.playerId);
    });

    if (allSkipped) {
      const result = settleCurrent(room, playersById, Date.now());
      if (result) {
        touch(room);
        scheduleAdvance(room, result.waitMs);
      }
      reply(ack, { ok: true, kind: result?.kind, allSkipped: true });
    } else {
      touch(room);
      broadcastRoom(room);
      reply(ack, { ok: true, allSkipped: false });
    }
  });

  socket.on('auction:end', (_rawPayload, ack) => {
    const context = hostContextFor(socket);
    if (context.error) {
      reply(ack, { ok: false, error: context.error });
      return;
    }
    const { room } = context;
    if (room.state !== 'auction') {
      reply(ack, { ok: false, error: 'The auction is not running.' });
      return;
    }
    endAuction(room, playersById);
    stopAuctionTimers(room);
    touch(room);
    broadcastRoom(room);
    reply(ack, { ok: true });
  });

  socket.on('auction:fillSquads', (_rawPayload, ack) => {
    const context = hostContextFor(socket);
    if (context.error) {
      reply(ack, { ok: false, error: context.error });
      return;
    }
    const { room } = context;
    if (room.state !== 'ended') {
      reply(ack, { ok: false, error: 'Finish the auction first.' });
      return;
    }
    const result = fillSquads(room, playersById);
    touch(room);
    broadcastRoom(room);
    reply(ack, { ok: true, ...result });
  });

  socket.on('simulation:run', (rawPayload, ack) => {
    const payload = payloadOf(rawPayload);
    const context = hostContextFor(socket);
    if (context.error) {
      reply(ack, { ok: false, error: context.error });
      return;
    }
    const { room } = context;
    if (room.state !== 'ended') {
      reply(ack, { ok: false, error: 'Finish the auction and fill short squads first.' });
      return;
    }

    const shortTeams = [...room.teams.values()].filter((team) => team.squad.length < 11);
    if (room.teams.size - shortTeams.length < 2) {
      reply(ack, {
        ok: false,
        error:
          shortTeams.length === room.teams.size
            ? `No complete squads. Fill squads first (${shortTeams.map((team) => team.teamName).join(', ')}).`
            : `Below 11 players: ${shortTeams.map((team) => team.teamName).join(', ')}. Two complete squads are needed.`,
      });
      return;
    }

    const seed = parseSeed(payload.seed);
    if (seed.error) {
      reply(ack, { ok: false, error: seed.error });
      return;
    }

    try {
      const result = simulateTournament(room, playersById, {
        seed,
        excludeTeamIds: shortTeams.map((team) => team.id),
      });
      room.simulation = result;
      touch(room);
      broadcastRoom(room);
      reply(ack, { ok: true, seed: result.seed });
    } catch (error) {
      reply(ack, { ok: false, error: error.message });
    }
  });

  socket.on('disconnect', () => {
    detachSocket(socket, { removeLobbyTeam: false });
  });
  });

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (now - room.updatedAt <= ROOM_IDLE_MS) continue;
      io.to(room.code).emit('room:closed', { reason: 'This room expired after two hours of inactivity.' });
      clearRoomTimers(room);
      rooms.delete(room.code);
    }
  }, 10 * 60 * 1000);
  cleanup.unref?.();
}

export { playersById, playerIds };
