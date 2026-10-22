import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROLES } from '../../shared/constants.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/players.json', import.meta.url), 'utf8'));

describe('generated player data', () => {
  it('has the expected pool and franchise count', () => {
    expect(data.meta.playerCount).toBe(257);
    expect(data.meta.teamCount).toBe(10);
    expect(data.players).toHaveLength(257);
    expect(data.teams).toHaveLength(10);
    expect(data.meta.overseasCount).toBe(82);
    expect(data.players.filter((player) => player.overseas)).toHaveLength(82);
  });

  it('has unique ids and valid roles', () => {
    const ids = data.players.map((player) => player.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const player of data.players) {
      expect(ROLES).toContain(player.role);
      expect(player.name.length).toBeGreaterThan(0);
      expect(player.basePriceLakh).toBeGreaterThan(0);
      expect(Number.isInteger(player.basePriceLakh)).toBe(true);
    }
  });

  it('uses integer lakh base prices from the published tiers', () => {
    const tiers = new Set([20, 30, 50, 75, 100, 150, 200]);
    for (const player of data.players) {
      expect(tiers.has(player.basePriceLakh)).toBe(true);
    }
  });

  it('excludes the three delivery-only players', () => {
    const names = new Set(data.players.map((player) => player.name));
    for (const name of data.meta.excludedPlayers) {
      expect(names.has(name)).toBe(false);
    }
  });

  it('includes the derived league rates used by the simulation', () => {
    expect(data.meta.league.runsPerBall).toBeGreaterThan(1);
    expect(data.meta.league.economy).toBeGreaterThan(7);
    expect(data.meta.league.wicketsPerOver).toBeGreaterThan(0.2);
  });

  it('has complete batting and bowling stat containers', () => {
    for (const player of data.players.slice(0, 50)) {
      expect(player.stats).toHaveProperty('batting.runs');
      expect(player.stats).toHaveProperty('batting.balls');
      expect(player.stats).toHaveProperty('bowling.wickets');
      expect(player.stats).toHaveProperty('bowling.balls');
      expect(player.ratings.overall).toBeGreaterThan(0);
    }
  });
});
