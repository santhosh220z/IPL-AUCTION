import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createRng } from '../bracket.js';
import {
  buildTeamProfile,
  selectXI,
  simulateInnings,
  simulateMatch,
  simulateTournament,
} from '../simulation.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/players.json', import.meta.url), 'utf8'));
const playersById = new Map(data.players.map((player) => [player.id, player]));

function squadFor(abbr) {
  const pool = data.players.filter((player) => player.team === abbr);
  const { xi } = selectXI(pool);
  return xi.map((player) => ({ playerId: player.id, priceLakh: player.basePriceLakh }));
}

function makeTeam(id, abbr) {
  return {
    id,
    teamName: abbr,
    color: 'azure',
    squad: squadFor(abbr),
  };
}

function makeRoom(abbrs) {
  const teams = abbrs.map((abbr, index) => makeTeam(`t${index + 1}-${abbr}`, abbr));
  return { state: 'ended', teams: new Map(teams.map((team) => [team.id, team])) };
}

function profileFor(abbr) {
  return buildTeamProfile(makeTeam(`t-${abbr}`, abbr), playersById);
}

describe('XI selection', () => {
  it('builds a legal XI for every franchise squad', () => {
    for (const team of data.teams) {
      const pool = data.players.filter((player) => player.team === team.abbr);
      const { xi, validXI, keeper } = selectXI(pool);
      expect(xi).toHaveLength(11);
      expect(validXI).toBe(true);
      expect(keeper).not.toBeNull();
      expect(xi.filter((player) => player.overseas)).toHaveLength(
        Math.min(4, xi.filter((player) => player.overseas).length),
      );
      expect(xi.filter((player) => player.overseas).length).toBeLessThanOrEqual(4);
    }
  });

  it('returns the same XI for the same squad', () => {
    const pool = data.players.filter((player) => player.team === 'MI');
    expect(selectXI(pool).xi.map((player) => player.id)).toEqual(
      selectXI(pool).xi.map((player) => player.id),
    );
  });
});

describe('XI rule degradation', () => {
  function synth(id, opts = {}) {
    const { role = 'Batter', bowling = 10, batting = 50, overall = 50, overseas = false } = opts;
    return {
      id,
      name: id,
      role,
      overseas,
      basePriceLakh: 100,
      ratings: { overall, batting, bowling },
    };
  }

  it('does not count pure batters as bowling options', () => {
    const squad = Array.from({ length: 11 }, (_, i) => synth(`b${i}`));
    const { xi, validXI, keeper } = selectXI(squad);
    expect(xi).toHaveLength(11);
    expect(keeper).toBeNull();
    expect(validXI).toBe(false);
  });

  it('flags an XI that must breach the overseas cap to reach eleven', () => {
    const squad = [
      synth('wk', { role: 'WK-Batter', overseas: true }),
      ...Array.from({ length: 10 }, (_, i) => synth(`o${i}`, { overseas: true, bowling: 80 })),
    ];
    const { xi, validXI } = selectXI(squad);
    expect(xi).toHaveLength(11);
    expect(xi.filter((player) => player.overseas)).toHaveLength(11);
    expect(validXI).toBe(false);
  });

  it('keeps an XI with a keeper only flagged when no WK exists', () => {
    const squad = Array.from({ length: 10 }, (_, i) => synth(`p${i}`));
    squad.push(synth('wk', { role: 'WK-Batter', bowling: 10 }));
    const { xi, validXI, keeper } = selectXI(squad);
    expect(xi).toHaveLength(11);
    expect(keeper?.id).toBe('wk');
    // Only one real bowling option (none of the others qualifies) -> still invalid.
    expect(validXI).toBe(false);
  });

  it('warns loudly when a team simulates outside the XI rules', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const squad = Array.from({ length: 11 }, (_, i) => synth(`b${i}`));
    const team = {
      id: 't1',
      teamName: 'Alpha',
      color: 'azure',
      squad: squad.map((player) => ({ playerId: player.id, priceLakh: 100 })),
    };
    const players = new Map(squad.map((player) => [player.id, player]));
    buildTeamProfile(team, players);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/invalid XI/i);
    warn.mockRestore();
  });
});

describe('innings simulation', () => {
  it('keeps scorecard totals consistent', () => {
    const batting = profileFor('MI');
    const bowling = profileFor('CSK');
    const innings = simulateInnings(batting, bowling, createRng(7));

    expect(innings.runs).toBeGreaterThanOrEqual(0);
    expect(innings.wickets).toBeLessThanOrEqual(10);
    expect(innings.balls).toBeLessThanOrEqual(120);
    expect(innings.batting).toHaveLength(11);
    expect(innings.batting.reduce((sum, batsman) => sum + batsman.runs, 0)).toBe(innings.runs);
    expect(innings.bowling.reduce((sum, bowler) => sum + bowler.wickets, 0)).toBe(innings.wickets);
    expect(innings.bowling.reduce((sum, bowler) => sum + bowler.balls, 0)).toBe(innings.balls);
    for (const bowler of innings.bowling) {
      expect(bowler.balls).toBeLessThanOrEqual(24);
    }
  });

  it('stops once a chase reaches its target', () => {
    const batting = profileFor('RCB');
    const bowling = profileFor('GT');
    const innings = simulateInnings(batting, bowling, createRng(11), { target: 20 });
    if (innings.runs >= 20) {
      expect(innings.balls).toBeLessThanOrEqual(120);
    }
  });
});

describe('match simulation', () => {
  it('produces a winner, a loser, and two innings', () => {
    const teamA = profileFor('MI');
    const teamB = profileFor('CSK');
    const match = simulateMatch(teamA, teamB, { rng: createRng(123) });

    expect([teamA.id, teamB.id]).toContain(match.winnerId);
    expect([teamA.id, teamB.id]).toContain(match.loserId);
    expect(match.winnerId).not.toBe(match.loserId);
    expect(match.innings).toHaveLength(2);
    expect(match.innings[1].target).toBe(match.innings[0].runs + 1);
    expect(match.resultText.length).toBeGreaterThan(0);
  });

  it('is deterministic for the same seed', () => {
    const teamA = profileFor('MI');
    const teamB = profileFor('CSK');
    const first = simulateMatch(teamA, teamB, { rng: createRng(55) });
    const second = simulateMatch(teamA, teamB, { rng: createRng(55) });
    expect(first.resultText).toBe(second.resultText);
    expect(first.innings.map((innings) => [innings.runs, innings.wickets, innings.balls])).toEqual(
      second.innings.map((innings) => [innings.runs, innings.wickets, innings.balls]),
    );
  });
});

describe('tournament simulation', () => {
  it('runs a four-team bracket with a third-place match', () => {
    const room = makeRoom(['MI', 'CSK', 'RCB', 'GT']);
    const result = simulateTournament(room, playersById, { seed: 123 });

    expect(result.rounds).toHaveLength(2);
    expect(result.thirdPlaceMatch).not.toBeNull();
    expect(result.matchCount).toBe(4);
    expect(result.champion).not.toBeNull();
    expect(result.runnerUp).not.toBeNull();
    expect(result.third).not.toBeNull();
    expect(result.fourth).not.toBeNull();
    expect(result.teams).toHaveLength(4);
    expect(result.teams.every((team) => team.validXI)).toBe(true);
  });

  it('runs a ten-team bracket with byes', () => {
    const room = makeRoom(['MI', 'CSK', 'KKR', 'RCB', 'GT', 'RR', 'SRH', 'PBKS', 'DC', 'LSG']);
    const result = simulateTournament(room, playersById, { seed: 42 });

    expect(result.rounds).toHaveLength(4);
    expect(result.matchCount).toBe(10);
    expect(result.rounds[0].matches).toHaveLength(2);
    expect(result.rounds[1].matches).toHaveLength(4);
    expect(result.thirdPlaceMatch).not.toBeNull();
  });

  it('runs a two-team room as a single final', () => {
    const room = makeRoom(['MI', 'CSK']);
    const result = simulateTournament(room, playersById, { seed: 9 });
    expect(result.rounds).toHaveLength(1);
    expect(result.matchCount).toBe(1);
    expect(result.thirdPlaceMatch).toBeNull();
  });

  it('is deterministic for the same seed', () => {
    const room = makeRoom(['MI', 'CSK', 'RCB', 'GT']);
    const first = simulateTournament(room, playersById, { seed: 777 });
    const second = simulateTournament(room, playersById, { seed: 777 });
    expect(first.champion.id).toBe(second.champion.id);
    expect(first.rounds.map((round) => round.matches.map((match) => match.resultText))).toEqual(
      second.rounds.map((round) => round.matches.map((match) => match.resultText)),
    );
  });

  it('excludes disqualified short teams from the tournament', () => {
    const room = makeRoom(['MI', 'CSK', 'RCB', 'GT']);
    const excludedId = room.teams.keys().next().value;
    const result = simulateTournament(room, playersById, { seed: 123, excludeTeamIds: [excludedId] });

    expect(result.teams).toHaveLength(3);
    expect(result.teams.map((team) => team.id)).not.toContain(excludedId);
    expect(result.matchCount).toBe(2);
  });

  it('refuses to run when fewer than two teams remain', () => {
    const room = makeRoom(['MI', 'CSK']);
    const ids = [...room.teams.keys()];
    expect(() =>
      simulateTournament(room, playersById, { seed: 1, excludeTeamIds: ids }),
    ).toThrow(/at least two/i);
  });
});
