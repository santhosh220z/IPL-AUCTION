import crypto from 'node:crypto';

export function nextPowerOfTwo(value) {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

export function createRng(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return crypto.randomInt(1, 2 ** 31 - 1);
}

export function shuffle(items, rng) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pairTeams(teams, rng) {
  const shuffled = shuffle(teams, rng);
  const pairs = [];
  for (let i = 0; i + 1 < shuffled.length; i += 2) {
    pairs.push([shuffled[i], shuffled[i + 1]]);
  }
  return pairs;
}

function roundName(round, totalRounds) {
  const roundNumber = round.round;
  const remaining = totalRounds - roundNumber;
  if (remaining === 1) return 'Final';
  if (remaining === 2) return round.matches.length === 2 ? 'Semifinal' : 'Play-in';
  if (remaining === 3) return round.matches.length === 4 ? 'Quarterfinal' : 'Round 1';
  if (remaining === 4) return round.matches.length === 8 ? 'Round of 16' : 'Round 1';
  return `Round ${roundNumber + 1}`;
}

export function runBracket(teams, rng, simulateMatch) {
  const teamCount = teams.length;
  if (teamCount < 2) throw new Error('A bracket needs at least two teams.');

  const shuffled = shuffle(teams, rng);
  const size = nextPowerOfTwo(teamCount);
  const playInTeams = 2 * teamCount - size;
  const byeTeams = shuffled.slice(playInTeams);
  let currentTeams = shuffled.slice(0, playInTeams);
  const rounds = [];
  let roundNumber = 0;
  let matchCounter = 0;

  while (currentTeams.length + (roundNumber === 0 ? byeTeams.length : 0) > 1) {
    const pendingByes = roundNumber === 0 ? byeTeams : [];
    const matches = [];

    if (currentTeams.length >= 2) {
      const pairs = pairTeams(currentTeams, rng);
      for (const [teamA, teamB] of pairs) {
        const result = simulateMatch(teamA, teamB, { rng, round: roundNumber });
        const winner = result.winnerId === teamA.id ? teamA : teamB;
        const loser = winner.id === teamA.id ? teamB : teamA;
        matchCounter += 1;
        matches.push({
          id: `m${matchCounter}`,
          round: roundNumber,
          teamA,
          teamB,
          winner,
          loser,
          ...result,
        });
      }
    }

    rounds.push({ round: roundNumber, matches });
    const winners = matches.map((match) => match.winner);
    currentTeams = [...pendingByes, ...winners];

    if (currentTeams.length <= 1) break;
    roundNumber += 1;

    if (roundNumber > 10) throw new Error('Bracket construction failed.');
  }

  const champion = rounds.at(-1)?.matches[0]?.winner ?? null;
  const runnerUp = rounds.at(-1)?.matches[0]?.loser ?? null;

  const totalRounds = rounds.length;
  for (const round of rounds) {
    round.name = round.round === 0 && byeTeams.length > 0 ? 'Play-in' : roundName(round, totalRounds);
  }

  let thirdPlaceMatch = null;
  let third = null;
  let fourth = null;

  if (teamCount === 3) {
    third = rounds[0]?.matches[0]?.loser ?? null;
  } else if (teamCount > 3) {
    const semifinalRound = rounds.at(-2);
    if (semifinalRound && semifinalRound.matches.length === 2) {
      const losers = semifinalRound.matches.map((match) => match.loser);
      const result = simulateMatch(losers[0], losers[1], { rng, round: totalRounds, placement: true });
      const winner = result.winnerId === losers[0].id ? losers[0] : losers[1];
      const loser = winner.id === losers[0].id ? losers[1] : losers[0];
      matchCounter += 1;
      thirdPlaceMatch = {
        id: `m${matchCounter}`,
        round: totalRounds,
        name: '3rd Place',
        teamA: losers[0],
        teamB: losers[1],
        winner,
        loser,
        ...result,
      };
      third = winner;
      fourth = loser;
    }
  }

  return {
    rounds,
    thirdPlaceMatch,
    champion,
    runnerUp,
    third,
    fourth,
    draw: shuffled.map((team) => team.id),
    matchCount: matchCounter,
  };
}
