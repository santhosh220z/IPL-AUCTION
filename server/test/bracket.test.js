import { describe, expect, it } from 'vitest';
import { createRng, nextPowerOfTwo, runBracket, shuffle } from '../bracket.js';

function makeTeams(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `t${index + 1}`,
    name: `Team ${index + 1}`,
    color: 'azure',
  }));
}

function simulate(teamA, teamB, { rng }) {
  const winnerId = rng() < 0.5 ? teamA.id : teamB.id;
  const loserId = winnerId === teamA.id ? teamB.id : teamA.id;
  return { winnerId, loserId, resultText: `${winnerId} won`, innings: [], superOver: null };
}

function run(count, seed = 1) {
  return runBracket(makeTeams(count), createRng(seed), simulate);
}

describe('bracket helpers', () => {
  it('rounds team counts up to a power of two', () => {
    expect(nextPowerOfTwo(2)).toBe(2);
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(nextPowerOfTwo(4)).toBe(4);
    expect(nextPowerOfTwo(5)).toBe(8);
    expect(nextPowerOfTwo(10)).toBe(16);
  });

  it('shuffles deterministically for a given seed', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(shuffle(items, createRng(42))).toEqual(shuffle(items, createRng(42)));
  });
});

describe('bracket shapes', () => {
  it('plays a single final for two teams', () => {
    const result = run(2);
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0].name).toBe('Final');
    expect(result.matchCount).toBe(1);
    expect(result.thirdPlaceMatch).toBeNull();
    expect(result.champion).not.toBeNull();
    expect(result.runnerUp).not.toBeNull();
  });

  it('uses a play-in and awards third to its loser for three teams', () => {
    const result = run(3);
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[0].name).toBe('Play-in');
    expect(result.rounds[0].matches).toHaveLength(1);
    expect(result.rounds[1].name).toBe('Final');
    expect(result.third.id).toBe(result.rounds[0].matches[0].loser.id);
    expect(result.thirdPlaceMatch).toBeNull();
    expect(result.matchCount).toBe(2);
  });

  it('adds a third-place match for four teams', () => {
    const result = run(4);
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[0].name).toBe('Semifinal');
    expect(result.rounds[1].name).toBe('Final');
    expect(result.thirdPlaceMatch).not.toBeNull();
    expect(result.third.id).toBe(result.thirdPlaceMatch.winner.id);
    expect(result.fourth.id).toBe(result.thirdPlaceMatch.loser.id);
    expect(result.matchCount).toBe(4);

    const semifinalLosers = result.rounds[0].matches.map((match) => match.loser.id).sort();
    const thirdPlaceTeams = [result.thirdPlaceMatch.teamA.id, result.thirdPlaceMatch.teamB.id].sort();
    expect(thirdPlaceTeams).toEqual(semifinalLosers);
  });

  it('handles byes for five teams', () => {
    const result = run(5);
    expect(result.rounds).toHaveLength(3);
    expect(result.rounds[0].name).toBe('Play-in');
    expect(result.rounds[0].matches).toHaveLength(1);
    expect(result.rounds[1].name).toBe('Semifinal');
    expect(result.rounds[2].name).toBe('Final');
    expect(result.matchCount).toBe(5);
    expect(new Set(result.draw).size).toBe(5);
  });

  it('handles ten teams with play-in, quarters, semis, and final', () => {
    const result = run(10);
    expect(result.rounds).toHaveLength(4);
    expect(result.rounds.map((round) => round.name)).toEqual([
      'Play-in',
      'Quarterfinal',
      'Semifinal',
      'Final',
    ]);
    expect(result.matchCount).toBe(10);
    expect(result.rounds[0].matches).toHaveLength(2);
    expect(result.rounds[1].matches).toHaveLength(4);
    expect(result.thirdPlaceMatch).not.toBeNull();
  });

  it('never schedules the same team twice in a round', () => {
    for (let count = 2; count <= 10; count += 1) {
      const result = run(count, count);
      for (const round of result.rounds) {
        const ids = round.matches.flatMap((match) => [match.teamA.id, match.teamB.id]);
        expect(new Set(ids).size).toBe(ids.length);
      }
      const allMatches = result.rounds.flatMap((round) => round.matches);
      for (const match of allMatches) {
        expect([match.teamA.id, match.teamB.id]).toContain(match.winner.id);
        expect([match.teamA.id, match.teamB.id]).toContain(match.loser.id);
        expect(match.winner.id).not.toBe(match.loser.id);
      }
    }
  });

  it('is deterministic for a seed', () => {
    const first = run(6, 99);
    const second = run(6, 99);
    expect(first.champion.id).toBe(second.champion.id);
    expect(first.draw).toEqual(second.draw);
  });
});
