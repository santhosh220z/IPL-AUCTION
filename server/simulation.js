import { createRng, randomSeed, runBracket } from './bracket.js';

const BASE_WEIGHTS = { 0: 0.295, 1: 0.325, 2: 0.105, 3: 0.015, 4: 0.14, 6: 0.07, W: 0.05 };

const PHASE_MULTIPLIERS = {
  powerplay: { 0: 1, 1: 1, 2: 0.9, 3: 0.8, 4: 1.1, 6: 1.2, W: 0.95 },
  middle: { 0: 1.05, 1: 1.1, 2: 1.05, 3: 1.1, 4: 0.85, 6: 0.8, W: 1 },
  death: { 0: 0.95, 1: 1, 2: 0.9, 3: 0.8, 4: 1.1, 6: 1.5, W: 1.2 },
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

export function formatOvers(balls) {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

function battingSkill(player) {
  return player?.ratings?.batting ?? 50;
}

function bowlingSkill(player) {
  return player?.ratings?.bowling ?? 50;
}

function pickWeighted(items, weights, rng) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return items[0];
  let roll = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items.at(-1);
}

export function selectXI(squadPlayers) {
  const sorted = [...squadPlayers].sort(
    (a, b) => b.ratings.overall - a.ratings.overall || a.name.localeCompare(b.name),
  );
  const picked = [];
  const overseasCount = () => picked.filter((player) => player.overseas).length;
  const canAdd = (player) =>
    !picked.some((existing) => existing.id === player.id) &&
    (!player.overseas || overseasCount() < 4);

  const keeper = sorted.find((player) => player.role === 'WK-Batter' && canAdd(player)) ?? null;
  if (keeper) picked.push(keeper);

  const bowlerCandidates = sorted
    .filter((player) => player.role !== 'WK-Batter')
    .sort(
      (a, b) =>
        bowlingSkill(b) - bowlingSkill(a) ||
        b.ratings.overall - a.ratings.overall ||
        a.name.localeCompare(b.name),
    );

  let bowlersAdded = 0;
  for (const player of bowlerCandidates) {
    if (bowlersAdded >= 5) break;
    if (canAdd(player)) {
      picked.push(player);
      bowlersAdded += 1;
    }
  }

  for (const player of sorted) {
    if (picked.length >= 11) break;
    if (canAdd(player)) picked.push(player);
  }

  let validXI = picked.length === 11 && overseasCount() <= 4 && Boolean(keeper);
  if (picked.length < 11) {
    for (const player of sorted) {
      if (picked.length >= 11) break;
      if (!picked.some((existing) => existing.id === player.id)) picked.push(player);
    }
    validXI = false;
  }

  const xi = picked.slice(0, 11);
  return { xi, validXI, keeper };
}

export function buildTeamProfile(team, playersById) {
  const squadPlayers = team.squad
    .map((entry) => {
      const player = playersById.get(entry.playerId);
      return player ? { ...player, priceLakh: entry.priceLakh } : null;
    })
    .filter(Boolean);

  if (squadPlayers.length < 11) {
    throw new Error(`${team.teamName} has only ${squadPlayers.length} players. Use Fill squad first.`);
  }

  const { xi, validXI, keeper } = selectXI(squadPlayers);
  const battingOrder = [...xi].sort(
    (a, b) =>
      battingSkill(b) - battingSkill(a) ||
      b.ratings.overall - a.ratings.overall ||
      a.name.localeCompare(b.name),
  );
  const bowlers = [...xi]
    .sort(
      (a, b) =>
        bowlingSkill(b) - bowlingSkill(a) ||
        b.ratings.overall - a.ratings.overall ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 6);

  return {
    id: team.id,
    name: team.teamName,
    color: team.color,
    xi,
    battingOrder,
    bowlers,
    designatedBowlers: bowlers.slice(0, 5),
    keeper,
    validXI,
    squadSize: squadPlayers.length,
    overseasCount: xi.filter((player) => player.overseas).length,
  };
}

function createBatsman(player, index) {
  return {
    player,
    index,
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    out: false,
    dismissal: null,
    didBat: false,
  };
}

function chooseBowler(bowlerStates, maxBallsPerBowler, lastBowlerId, rng) {
  let eligible = bowlerStates.filter(
    (bowler) => bowler.balls < maxBallsPerBowler && bowler.player.id !== lastBowlerId,
  );
  if (eligible.length === 0) {
    eligible = bowlerStates.filter((bowler) => bowler.balls < maxBallsPerBowler);
  }
  if (eligible.length === 0) return null;
  const weights = eligible.map((bowler) => Math.max(1, (bowlingSkill(bowler.player) - 30) ** 2));
  return pickWeighted(eligible, weights, rng);
}

function chooseOutcome(batter, bowler, over, rng) {
  const weights = { ...BASE_WEIGHTS };
  const diff = clamp((battingSkill(batter) - bowlingSkill(bowler)) / 100, -0.6, 0.6);
  weights[4] *= 1 + 0.6 * diff;
  weights[6] *= 1 + 0.9 * diff;
  weights.W *= 1 - 0.7 * diff;
  weights[1] *= 1 - 0.1 * diff;
  weights[2] *= 1 + 0.2 * diff;
  weights[0] *= 1 - 0.2 * diff;

  const phase = over < 6 ? 'powerplay' : over < 15 ? 'middle' : 'death';
  const multipliers = PHASE_MULTIPLIERS[phase];
  for (const key of Object.keys(weights)) {
    weights[key] *= multipliers[key] ?? 1;
  }
  weights.W = clamp(weights.W, 0.015, 0.09);

  const keys = Object.keys(weights);
  const key = pickWeighted(
    keys,
    keys.map((outcome) => weights[outcome]),
    rng,
  );
  return key === 'W' ? 'W' : Number(key);
}

function dismissalText(bowler) {
  return `b ${bowler.name}`;
}

export function simulateInnings(battingTeam, bowlingTeam, rng, options = {}) {
  const overs = options.overs ?? 20;
  const maxWickets = options.maxWickets ?? 10;
  const maxBatsmen = Math.min(options.maxBatsmen ?? 11, battingTeam.battingOrder.length);
  const maxBalls = overs * 6;
  const maxBallsPerBowler = options.maxBallsPerBowler ?? Math.min(24, maxBalls);
  const maxBowlers = Math.min(options.maxBowlers ?? 6, bowlingTeam.bowlers.length);
  const target = options.target ?? null;

  const batsmen = battingTeam.battingOrder.slice(0, maxBatsmen).map(createBatsman);
  const bowlerStates = bowlingTeam.bowlers.slice(0, maxBowlers).map((player) => ({
    player,
    balls: 0,
    runs: 0,
    wickets: 0,
    maidens: 0,
  }));

  let strikerIndex = 0;
  let nonStrikerIndex = 1;
  let nextBatsmanIndex = 2;
  batsmen[0].didBat = true;
  batsmen[1].didBat = true;

  let runs = 0;
  let wickets = 0;
  let balls = 0;
  let lastBowlerId = null;
  const fallOfWickets = [];
  let ended = false;

  for (let over = 0; over < overs; over += 1) {
    if (ended || wickets >= maxWickets || balls >= maxBalls) break;
    const bowler = chooseBowler(bowlerStates, maxBallsPerBowler, lastBowlerId, rng);
    if (!bowler) break;
    let overRuns = 0;

    for (let ballInOver = 0; ballInOver < 6; ballInOver += 1) {
      if (balls >= maxBalls || wickets >= maxWickets) {
        ended = true;
        break;
      }

      const striker = batsmen[strikerIndex];
      const outcome = chooseOutcome(striker.player, bowler.player, over, rng);

      balls += 1;
      striker.balls += 1;
      bowler.balls += 1;

      if (outcome === 'W') {
        bowler.wickets += 1;
        striker.out = true;
        striker.dismissal = dismissalText(bowler.player);
        wickets += 1;
        fallOfWickets.push({
          wicket: wickets,
          runs,
          over: formatOvers(balls),
          batsman: striker.player.name,
        });

        if (wickets >= maxWickets || nextBatsmanIndex >= batsmen.length) {
          ended = true;
          break;
        }
        strikerIndex = nextBatsmanIndex;
        batsmen[strikerIndex].didBat = true;
        nextBatsmanIndex += 1;
      } else {
        runs += outcome;
        overRuns += outcome;
        striker.runs += outcome;
        bowler.runs += outcome;
        if (outcome === 4) striker.fours += 1;
        if (outcome === 6) striker.sixes += 1;
        if (outcome % 2 === 1) {
          [strikerIndex, nonStrikerIndex] = [nonStrikerIndex, strikerIndex];
        }
      }

      if (target != null && runs >= target) {
        ended = true;
        break;
      }
    }

    if (overRuns === 0 && balls % 6 === 0 && !ended) bowler.maidens += 1;

    if (ended) break;
    [strikerIndex, nonStrikerIndex] = [nonStrikerIndex, strikerIndex];
    lastBowlerId = bowler.player.id;
  }

  const batting = batsmen.map((batsman) => ({
    id: batsman.player.id,
    name: batsman.player.name,
    role: batsman.player.role,
    runs: batsman.runs,
    balls: batsman.balls,
    fours: batsman.fours,
    sixes: batsman.sixes,
    out: batsman.out,
    dismissal: batsman.dismissal,
    didBat: batsman.didBat,
    strikeRate: batsman.balls > 0 ? round2((batsman.runs / batsman.balls) * 100) : null,
  }));

  const bowling = bowlerStates
    .filter((bowler) => bowler.balls > 0)
    .map((bowler) => ({
      id: bowler.player.id,
      name: bowler.player.name,
      balls: bowler.balls,
      overs: formatOvers(bowler.balls),
      maidens: bowler.maidens,
      runs: bowler.runs,
      wickets: bowler.wickets,
      economy: bowler.balls > 0 ? round2(bowler.runs / (bowler.balls / 6)) : null,
    }));

  return {
    teamId: battingTeam.id,
    teamName: battingTeam.name,
    runs,
    wickets,
    balls,
    overs: formatOvers(balls),
    runRate: balls > 0 ? round2((runs / balls) * 6) : 0,
    target,
    batting,
    bowling,
    fallOfWickets,
  };
}

export function simulateSuperOver(teamA, teamB, rng) {
  const attempts = [];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const first = attempt % 2 === 0 ? teamA : teamB;
    const second = first.id === teamA.id ? teamB : teamA;
    const firstInnings = simulateInnings(first, second, rng, {
      overs: 1,
      maxWickets: 2,
      maxBatsmen: 3,
      maxBallsPerBowler: 6,
      maxBowlers: 2,
    });
    const secondInnings = simulateInnings(second, first, rng, {
      overs: 1,
      maxWickets: 2,
      maxBatsmen: 3,
      maxBallsPerBowler: 6,
      maxBowlers: 2,
      target: firstInnings.runs + 1,
    });

    attempts.push({ first: firstInnings, second: secondInnings });

    if (firstInnings.runs !== secondInnings.runs) {
      const winner = secondInnings.runs > firstInnings.runs ? second : first;
      const loser = winner.id === first.id ? second : first;
      return {
        winnerId: winner.id,
        loserId: loser.id,
        winner,
        loser,
        attempts,
        resultText: `${winner.name} won the Super Over`,
      };
    }
  }

  const winner = rng() < 0.5 ? teamA : teamB;
  const loser = winner.id === teamA.id ? teamB : teamA;
  return {
    winnerId: winner.id,
    loserId: loser.id,
    winner,
    loser,
    attempts,
    resultText: `${winner.name} won after a tied Super Over`,
  };
}

export function simulateMatch(teamA, teamB, { rng }) {
  const first = rng() < 0.5 ? teamA : teamB;
  const second = first.id === teamA.id ? teamB : teamA;

  const firstInnings = simulateInnings(first, second, rng);
  const secondInnings = simulateInnings(second, first, rng, { target: firstInnings.runs + 1 });

  if (secondInnings.runs > firstInnings.runs) {
    const wicketsLeft = Math.max(0, 10 - secondInnings.wickets);
    const ballsLeft = Math.max(0, 120 - secondInnings.balls);
    return {
      winnerId: second.id,
      loserId: first.id,
      resultText: `${second.name} won by ${wicketsLeft} wicket${wicketsLeft === 1 ? '' : 's'}${
        ballsLeft > 0 ? ` (${ballsLeft} balls left)` : ''
      }`,
      innings: [firstInnings, secondInnings],
      superOver: null,
    };
  }

  if (secondInnings.runs < firstInnings.runs) {
    const margin = firstInnings.runs - secondInnings.runs;
    return {
      winnerId: first.id,
      loserId: second.id,
      resultText: `${first.name} won by ${margin} run${margin === 1 ? '' : 's'}`,
      innings: [firstInnings, secondInnings],
      superOver: null,
    };
  }

  const superOver = simulateSuperOver(teamA, teamB, rng);
  return {
    winnerId: superOver.winnerId,
    loserId: superOver.loserId,
    resultText: `Match tied - ${superOver.resultText}`,
    innings: [firstInnings, secondInnings],
    superOver,
  };
}

function teamRef(team) {
  if (!team) return null;
  return { id: team.id, name: team.name, color: team.color };
}

function serializeMatch(match) {
  return {
    id: match.id,
    round: match.round,
    name: match.name ?? null,
    teamA: teamRef(match.teamA),
    teamB: teamRef(match.teamB),
    winnerId: match.winnerId,
    loserId: match.loserId,
    winner: teamRef(match.winner),
    loser: teamRef(match.loser),
    resultText: match.resultText,
    innings: match.innings,
    superOver: match.superOver
      ? {
          winnerId: match.superOver.winnerId,
          loserId: match.superOver.loserId,
          winner: teamRef(match.superOver.winner),
          loser: teamRef(match.superOver.loser),
          resultText: match.superOver.resultText,
          attempts: match.superOver.attempts,
        }
      : null,
  };
}

export function simulateTournament(room, playersById, options = {}) {
  const teams = [...room.teams.values()];
  if (teams.length < 2) throw new Error('At least two teams are needed to simulate the tournament.');

  const profiles = teams.map((team) => buildTeamProfile(team, playersById));
  const seed = options.seed ?? randomSeed();
  const rng = createRng(seed);
  const bracket = runBracket(profiles, rng, (teamA, teamB, context) =>
    simulateMatch(teamA, teamB, context),
  );

  return {
    seed,
    generatedAt: Date.now(),
    teams: profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      color: profile.color,
      validXI: profile.validXI,
      xi: profile.xi.map((player) => ({
        id: player.id,
        name: player.name,
        role: player.role,
        overseas: player.overseas,
        ratings: player.ratings,
        priceLakh: player.priceLakh,
      })),
    })),
    draw: bracket.draw,
    rounds: bracket.rounds.map((round) => ({
      round: round.round,
      name: round.name,
      matches: round.matches.map(serializeMatch),
    })),
    thirdPlaceMatch: bracket.thirdPlaceMatch ? serializeMatch(bracket.thirdPlaceMatch) : null,
    champion: teamRef(bracket.champion),
    runnerUp: teamRef(bracket.runnerUp),
    third: teamRef(bracket.third),
    fourth: teamRef(bracket.fourth),
    matchCount: bracket.matchCount,
  };
}
