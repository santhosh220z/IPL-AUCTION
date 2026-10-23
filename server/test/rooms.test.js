import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, MAX_TEAMS } from '../../shared/constants.js';
import { beginNextPlayer, createAuctionState, placeBid } from '../auction.js';
import {
  createRoom,
  findTeamByToken,
  getRoom,
  joinRoom,
  previewRoom,
  promoteHost,
  removeTeam,
  rooms,
  snapshotRoom,
} from '../rooms.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/players.json', import.meta.url), 'utf8'));
const playersById = new Map(data.players.map((player) => [player.id, player]));

function freshRoom() {
  const result = createRoom({ teamName: 'Alpha', color: 'azure' });
  expect(result.ok).toBe(true);
  return result;
}

describe('room creation and joining', () => {
  it('creates a room with a valid code and host', () => {
    const { room, team } = freshRoom();
    expect(room.code).toHaveLength(CODE_LENGTH);
    expect([...room.code].every((character) => CODE_ALPHABET.includes(character))).toBe(true);
    expect(getRoom(room.code)).toBe(room);
    expect(room.hostId).toBe(team.id);
    expect(room.state).toBe('lobby');
    expect(previewRoom(room).playerCount).toBe(1);
    rooms.delete(room.code);
  });

  it('validates team names and colors', () => {
    expect(createRoom({ teamName: '', color: 'azure' }).ok).toBe(false);
    expect(createRoom({ teamName: 'A', color: 'azure' }).ok).toBe(false);
    expect(createRoom({ teamName: 'Valid', color: 'not-a-color' }).ok).toBe(false);
    expect(createRoom({ teamName: 'Valid', color: 'azure' }).ok).toBe(true);
    rooms.clear();
  });

  it('rejects duplicate names and colors case-insensitively', () => {
    const { room } = freshRoom();
    expect(joinRoom(room, { teamName: 'alpha', color: 'amber' }).ok).toBe(false);
    expect(joinRoom(room, { teamName: 'Beta', color: 'azure' }).ok).toBe(false);
    expect(joinRoom(room, { teamName: 'Beta', color: 'amber' }).ok).toBe(true);
    expect(room.teams.size).toBe(2);
    rooms.delete(room.code);
  });

  it('rejects joins after the auction starts and when full', () => {
    const { room } = freshRoom();
    room.state = 'auction';
    expect(joinRoom(room, { teamName: 'Beta', color: 'amber' }).error).toMatch(/started/i);

    room.state = 'lobby';
    for (let index = room.teams.size; index < MAX_TEAMS; index += 1) {
      room.teams.set(`filler-${index}`, {
        id: `filler-${index}`,
        teamName: `Filler ${index}`,
        color: `color-${index}`,
      });
    }
    expect(joinRoom(room, { teamName: 'Late', color: 'rose' }).error).toMatch(/full/i);
    rooms.delete(room.code);
  });

  it('finds a team by reconnect token', () => {
    const { room, team } = freshRoom();
    expect(findTeamByToken(room, team.token)).toBe(team);
    expect(findTeamByToken(room, 'nope')).toBeNull();
    rooms.delete(room.code);
  });
});

describe('host promotion and snapshots', () => {
  it('promotes the next connected team when the host leaves', () => {
    const { room, team } = freshRoom();
    const joined = joinRoom(room, { teamName: 'Beta', color: 'amber' });
    expect(joined.ok).toBe(true);
    joined.team.connected = true;
    team.connected = false;

    expect(promoteHost(room)).toBe(joined.team);
    expect(room.hostId).toBe(joined.team.id);

    removeTeam(room, joined.team.id);
    expect(room.hostId).toBe(team.id);
    rooms.delete(room.code);
  });

  it('builds a lobby snapshot without auction state', () => {
    const { room, team } = freshRoom();
    const snapshot = snapshotRoom(room, playersById, team.id);
    expect(snapshot.code).toBe(room.code);
    expect(snapshot.youId).toBe(team.id);
    expect(snapshot.teams).toHaveLength(1);
    expect(snapshot.teams[0].isHost).toBe(true);
    expect(snapshot.auction).toBeNull();
    expect(snapshot.settings.purseLakh).toBe(12000);
    rooms.delete(room.code);
  });

  it('includes the current auction lot and bid state', () => {
    const { room, team } = freshRoom();
    const joined = joinRoom(room, { teamName: 'Beta', color: 'amber' });
    expect(joined.ok).toBe(true);

    room.state = 'auction';
    const playerId = data.players[0].id;
    room.auction = createAuctionState([playerId], 15);
    beginNextPlayer(room, playersById, 1000);
    expect(placeBid(room, team.id, playersById, 1, 2000).ok).toBe(true);

    const snapshot = snapshotRoom(room, playersById, joined.team.id);
    expect(snapshot.state).toBe('auction');
    expect(snapshot.auction.current.player.id).toBe(playerId);
    expect(snapshot.auction.current.leaderId).toBe(team.id);
    expect(snapshot.auction.current.currentBidLakh).toBe(data.players[0].basePriceLakh);
    expect(snapshot.auction.lastEvent.type).toBe('bid');
    rooms.delete(room.code);
  });
});
