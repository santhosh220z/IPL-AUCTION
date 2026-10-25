import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsvObjects } from './lib/csv.mjs';
import { cleanName, normalizeKey, slugify, splitFielders } from './lib/normalize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RAW_DIR = path.join(ROOT, 'ipl dataset');
const OUT_FILE = path.join(ROOT, 'all_players.json');

const aliases = JSON.parse(fs.readFileSync(path.join(HERE, 'player-aliases.json'), 'utf8'));
const { teamFixes, playerFixes, deliveryAliases } = aliases;

const TEAM_ABBR = {
  'Mumbai Indians': 'MI',
  'Chennai Super Kings': 'CSK',
  'Kolkata Knight Riders': 'KKR',
  'Royal Challengers Bengaluru': 'RCB',
  'Gujarat Titans': 'GT',
  'Rajasthan Royals': 'RR',
  'Sunrisers Hyderabad': 'SRH',
  'Punjab Kings': 'PBKS',
  'Delhi Capitals': 'DC',
  'Lucknow Super Giants': 'LSG',
};

const TEAM_ORDER = ['MI', 'CSK', 'KKR', 'RCB', 'GT', 'RR', 'SRH', 'PBKS', 'DC', 'LSG'];

const ROLE_MAP = {
  Batter: 'Batter',
  Bowler: 'Bowler',
  'All Rounder': 'All-rounder',
  'Wicket Keeper': 'WK-Batter',
};

const SET_ORDER = ['Marquee', 'Batters', 'Wicketkeepers', 'All-rounders', 'Bowlers'];
const EXCLUDED_NAMES = ['Dilshan Madushanka', 'George Linde', 'Krish Bhagat'];
const EXCLUDED_PLAYERS = new Set(EXCLUDED_NAMES.map((name) => normalizeKey(name)));
const BOWLER_WICKETS = new Set([
  'caught',
  'bowled',
  'lbw',
  'stumped',
  'hit wicket',
  'caught and bowled',
  'obstructing the field',
]);

function readCsv(name) {
  return parseCsvObjects(fs.readFileSync(path.join(RAW_DIR, name), 'utf8'));
}

function toInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function canonicalPlayerName(raw) {
  const name = cleanName(raw);
  return playerFixes[name] ?? name;
}

function resolveDeliveryName(raw) {
  const name = cleanName(raw);
  const alias = deliveryAliases[normalizeKey(name)];
  return canonicalPlayerName(alias ?? name);
}

function normalizeWicketType(raw) {
  const type = cleanName(raw).toLowerCase();
  if (type === 'run out') return 'runout';
  if (type === 'hitwicket') return 'hit wicket';
  return type;
}

function round(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values) {
  if (values.length === 0) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
}

function zScore(value, avg, deviation) {
  if (deviation <= 0) return 0;
  return clamp((value - avg) / deviation, -2.5, 2.5);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function emptyStats() {
  return {
    matches: 0,
    batting: { innings: 0, runs: 0, balls: 0, dismissals: 0, fours: 0, sixes: 0, dotBalls: 0 },
    bowling: { innings: 0, balls: 0, runs: 0, wickets: 0, dotBalls: 0 },
    fielding: { catches: 0, stumpings: 0, runOuts: 0 },
  };
}

const players = [];
const byName = new Map();

for (const row of readCsv('squads.csv')) {
  const rawTeam = cleanName(row.team_name);
  const teamName = teamFixes[rawTeam] ?? rawTeam;
  const team = TEAM_ABBR[teamName];
  if (!team) throw new Error(`Unknown team: ${rawTeam}`);

  const name = canonicalPlayerName(row.player);
  const key = normalizeKey(name);
  if (byName.has(key)) throw new Error(`Duplicate player name: ${name}`);

  const role = ROLE_MAP[cleanName(row.role)];
  if (!role) throw new Error(`Unknown role for ${name}: ${row.role}`);

  const player = {
    id: '',
    name,
    team,
    teamName,
    role,
    overseas: cleanName(row.nationality) === 'Overseas',
    captain: cleanName(row.designation) === 'Captain',
    basePriceLakh: 0,
    set: '',
    ratings: { batting: 0, bowling: 0, fielding: 0, overall: 0 },
    stats: emptyStats(),
    matchIds: new Set(),
    battingInnings: new Set(),
    bowlingInnings: new Set(),
  };

  const baseId = slugify(name) || `player-${players.length + 1}`;
  let id = baseId;
  let suffix = 2;
  while (players.some((existing) => existing.id === id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  player.id = id;

  players.push(player);
  byName.set(key, player);
}

const deliveries = readCsv('deliveries.csv');
const unmatched = new Map();

function lookup(raw) {
  const name = resolveDeliveryName(raw);
  const player = byName.get(normalizeKey(name));
  if (!player && cleanName(raw)) {
    const key = cleanName(raw);
    if (!EXCLUDED_PLAYERS.has(normalizeKey(key))) {
      unmatched.set(key, (unmatched.get(key) ?? 0) + 1);
    }
  }
  return player;
}

for (const row of deliveries) {
  const matchId = toInt(row.match_no);
  const innings = toInt(row.innings);
  const inningsKey = `${matchId}|${innings}`;
  const wicketType = normalizeWicketType(row.wicket_type);
  const wide = toInt(row.wide);
  const noBall = toInt(row.noballs);
  const extras = toInt(row.extras);
  const batRuns = toInt(row.runs_of_bat);

  const striker = lookup(row.striker);
  if (striker) {
    striker.matchIds.add(matchId);
    striker.battingInnings.add(inningsKey);
    if (wide === 0) {
      striker.stats.batting.balls += 1;
      if (batRuns === 0) striker.stats.batting.dotBalls += 1;
    }
    striker.stats.batting.runs += batRuns;
    if (batRuns === 4) striker.stats.batting.fours += 1;
    if (batRuns === 6) striker.stats.batting.sixes += 1;
  }

  if (wicketType && wicketType !== 'retired hurt') {
    const dismissed = lookup(row.player_dismissed);
    if (dismissed) {
      dismissed.matchIds.add(matchId);
      // A non-striker cannot face a ball, so without this line their only
      // innings would be invisible (innings=0 with a dismissal) and the
      // batting average would report null.
      dismissed.battingInnings.add(inningsKey);
      dismissed.stats.batting.dismissals += 1;
    }
  }

  const bowler = lookup(row.bowler);
  if (bowler) {
    bowler.matchIds.add(matchId);
    bowler.bowlingInnings.add(inningsKey);
    const legal = wide === 0 && noBall === 0;
    if (legal) {
      bowler.stats.bowling.balls += 1;
      if (batRuns === 0 && extras === 0) bowler.stats.bowling.dotBalls += 1;
    }
    bowler.stats.bowling.runs += batRuns + wide + noBall;
    if (BOWLER_WICKETS.has(wicketType)) bowler.stats.bowling.wickets += 1;
  }

  if (wicketType === 'caught' || wicketType === 'stumped' || wicketType === 'runout') {
    let fielder = null;
    for (const rawName of splitFielders(row.fielder)) {
      fielder = lookup(rawName);
      if (fielder) break;
    }
    if (fielder) {
      fielder.matchIds.add(matchId);
      if (wicketType === 'caught') fielder.stats.fielding.catches += 1;
      if (wicketType === 'stumped') fielder.stats.fielding.stumpings += 1;
      if (wicketType === 'runout') fielder.stats.fielding.runOuts += 1;
    }
  }
}

for (const player of players) {
  player.stats.matches = player.matchIds.size;
  player.stats.batting.innings = player.battingInnings.size;
  player.stats.bowling.innings = player.bowlingInnings.size;

  const batting = player.stats.batting;
  batting.average = batting.innings > 0 ? round(batting.dismissals > 0 ? batting.runs / batting.dismissals : batting.runs, 2) : null;
  batting.strikeRate = batting.balls > 0 ? round((batting.runs / batting.balls) * 100, 1) : null;

  const bowling = player.stats.bowling;
  bowling.economy = bowling.balls > 0 ? round(bowling.runs / (bowling.balls / 6), 2) : null;
  bowling.average = bowling.wickets > 0 ? round(bowling.runs / bowling.wickets, 2) : null;
  bowling.strikeRate = bowling.wickets > 0 ? round(bowling.balls / bowling.wickets, 1) : null;

  const fielding = player.stats.fielding;
  fielding.total = fielding.catches + fielding.stumpings + fielding.runOuts;
}

const totalBatRuns = players.reduce((sum, player) => sum + player.stats.batting.runs, 0);
const totalBallsFaced = players.reduce((sum, player) => sum + player.stats.batting.balls, 0);
const totalBatInnings = players.reduce((sum, player) => sum + player.stats.batting.innings, 0);
const totalDismissals = players.reduce((sum, player) => sum + player.stats.batting.dismissals, 0);
const totalBoundaries = players.reduce((sum, player) => sum + player.stats.batting.fours + player.stats.batting.sixes, 0);
const totalBowlBalls = players.reduce((sum, player) => sum + player.stats.bowling.balls, 0);
const totalBowlRuns = players.reduce((sum, player) => sum + player.stats.bowling.runs, 0);
const totalWickets = players.reduce((sum, player) => sum + player.stats.bowling.wickets, 0);
const totalBowlDots = players.reduce((sum, player) => sum + player.stats.bowling.dotBalls, 0);
const totalMatches = players.reduce((sum, player) => sum + player.stats.matches, 0);
const totalFieldDismissals = players.reduce((sum, player) => sum + player.stats.fielding.total, 0);

const league = {
  runsPerBall: totalBatRuns / Math.max(1, totalBallsFaced),
  runsPerInnings: totalBatRuns / Math.max(1, totalBatInnings),
  boundariesPerBall: totalBoundaries / Math.max(1, totalBallsFaced),
  average: totalBatRuns / Math.max(1, totalDismissals),
  economy: totalBowlRuns / Math.max(1, totalBowlBalls / 6),
  wicketsPerOver: totalWickets / Math.max(1, totalBowlBalls / 6),
  dotPct: totalBowlDots / Math.max(1, totalBowlBalls),
  fieldPerMatch: totalFieldDismissals / Math.max(1, totalMatches),
};

const PRIOR_BALLS = 90;
const PRIOR_DISMISSALS = 5;
const PRIOR_OVERS = 15;
const PRIOR_MATCHES = 4;
const PRIOR_INNINGS = 3;

for (const player of players) {
  const batting = player.stats.batting;
  const bowling = player.stats.bowling;
  const fielding = player.stats.fielding;

  const adjBatRuns = batting.runs + league.runsPerBall * PRIOR_BALLS;
  const adjBatBalls = batting.balls + PRIOR_BALLS;
  player._zInput = {
    batSR: (adjBatRuns / adjBatBalls) * 100,
    batBoundary: (batting.fours + batting.sixes + league.boundariesPerBall * PRIOR_BALLS) / adjBatBalls,
    batAverage: (batting.runs + league.average * PRIOR_DISMISSALS) / (batting.dismissals + PRIOR_DISMISSALS),
    batRunsPerInnings: (batting.runs + league.runsPerInnings * PRIOR_INNINGS) / (batting.innings + PRIOR_INNINGS),
    bowlEconomy: (bowling.runs + league.economy * PRIOR_OVERS) / (bowling.balls / 6 + PRIOR_OVERS),
    bowlWickets: (bowling.wickets + league.wicketsPerOver * PRIOR_OVERS) / (bowling.balls / 6 + PRIOR_OVERS),
    bowlWicketsTotal: (bowling.wickets + league.wicketsPerOver * PRIOR_OVERS * 0.5) / (player.stats.matches + PRIOR_MATCHES),
    bowlDotPct: (bowling.dotBalls + league.dotPct * PRIOR_BALLS) / (bowling.balls + PRIOR_BALLS),
    fieldRate: (fielding.total + league.fieldPerMatch * PRIOR_MATCHES) / (player.stats.matches + PRIOR_MATCHES),
  };
}

const metricNames = ['batSR', 'batBoundary', 'batAverage', 'batRunsPerInnings', 'bowlEconomy', 'bowlWickets', 'bowlWicketsTotal', 'bowlDotPct', 'fieldRate'];
const metricStats = {};
for (const metric of metricNames) {
  const values = players.map((player) => player._zInput[metric]);
  metricStats[metric] = { mean: mean(values), sd: stdDev(values) };
}

for (const player of players) {
  const input = player._zInput;
  const zBatSR = zScore(input.batSR, metricStats.batSR.mean, metricStats.batSR.sd);
  const zBatBoundary = zScore(input.batBoundary, metricStats.batBoundary.mean, metricStats.batBoundary.sd);
  const zBatAverage = zScore(input.batAverage, metricStats.batAverage.mean, metricStats.batAverage.sd);
  const zBatRuns = zScore(input.batRunsPerInnings, metricStats.batRunsPerInnings.mean, metricStats.batRunsPerInnings.sd);
  const zBowlEconomy = -zScore(input.bowlEconomy, metricStats.bowlEconomy.mean, metricStats.bowlEconomy.sd);
  const zBowlWickets = zScore(input.bowlWickets, metricStats.bowlWickets.mean, metricStats.bowlWickets.sd);
  const zBowlWicketsTotal = zScore(input.bowlWicketsTotal, metricStats.bowlWicketsTotal.mean, metricStats.bowlWicketsTotal.sd);
  const zBowlDot = zScore(input.bowlDotPct, metricStats.bowlDotPct.mean, metricStats.bowlDotPct.sd);
  const zField = zScore(input.fieldRate, metricStats.fieldRate.mean, metricStats.fieldRate.sd);

  const battingRating = clamp(50 + 18 * (0.3 * zBatSR + 0.2 * zBatBoundary + 0.25 * zBatAverage + 0.25 * zBatRuns), 1, 99);
  const bowlingRating = clamp(50 + 18 * (0.35 * zBowlEconomy + 0.3 * zBowlWickets + 0.2 * zBowlWicketsTotal + 0.15 * zBowlDot), 1, 99);
  const fieldingRating = clamp(50 + 18 * zField, 1, 99);

  let overall;
  if (player.role === 'Batter') {
    overall = 0.82 * battingRating + 0.1 * fieldingRating + 0.08 * bowlingRating;
  } else if (player.role === 'WK-Batter') {
    overall = 0.75 * battingRating + 0.2 * fieldingRating + 0.05 * bowlingRating;
  } else if (player.role === 'All-rounder') {
    overall = 0.48 * battingRating + 0.42 * bowlingRating + 0.1 * fieldingRating;
  } else {
    overall = 0.15 * battingRating + 0.75 * bowlingRating + 0.1 * fieldingRating;
  }

  player.ratings = {
    batting: round(battingRating, 1),
    bowling: round(bowlingRating, 1),
    fielding: round(fieldingRating, 1),
    overall: round(overall, 1),
  };
  delete player._zInput;
}

for (const player of players) {
  const sampleConfidence = 0.7 + 0.3 * Math.min(1, player.stats.matches / 12);
  player.marketScore = player.ratings.overall * sampleConfidence;
}

const ranked = [...players].sort((a, b) => b.marketScore - a.marketScore || a.name.localeCompare(b.name));

const priceForRank = (index) => {
  const percentile = index / ranked.length;
  if (percentile < 0.04) return 200;
  if (percentile < 0.12) return 150;
  if (percentile < 0.27) return 100;
  if (percentile < 0.47) return 75;
  if (percentile < 0.7) return 50;
  if (percentile < 0.9) return 30;
  return 20;
};

ranked.forEach((player, index) => {
  player.basePriceLakh = priceForRank(index);
});

const marquee = new Set(ranked.slice(0, 12).map((player) => player.id));
for (const player of players) {
  if (marquee.has(player.id)) player.set = 'Marquee';
  else if (player.role === 'Batter') player.set = 'Batters';
  else if (player.role === 'WK-Batter') player.set = 'Wicketkeepers';
  else if (player.role === 'All-rounder') player.set = 'All-rounders';
    else player.set = 'Bowlers';
  }

  const squadPlayerCount = players.length;
  if (squadPlayerCount !== 257) throw new Error(`Expected 257 squad players, got ${squadPlayerCount}`);

  const EXTRA_PLAYERS_PATH = path.join(ROOT, 'new_players.json');
  let auctionPoolPlayers = [];
  try {
    const extra = JSON.parse(fs.readFileSync(EXTRA_PLAYERS_PATH, 'utf8'));
    if (extra.merge !== false) {
      auctionPoolPlayers = extra.players.filter((player) => !byName.has(normalizeKey(player.name)));
      if (auctionPoolPlayers.length > 0) {
        console.warn(`Merged ${auctionPoolPlayers.length} auction-pool players from new_players.json`);
      }
    }
  } catch {}

  players.push(...auctionPoolPlayers);

  players.sort((a, b) => {
  const setDelta = SET_ORDER.indexOf(a.set) - SET_ORDER.indexOf(b.set);
  if (setDelta !== 0) return setDelta;
  return b.ratings.overall - a.ratings.overall || a.name.localeCompare(b.name);
});

for (const player of players) {
  delete player.matchIds;
  delete player.battingInnings;
  delete player.bowlingInnings;
  delete player.marketScore;
}

const teams = TEAM_ORDER.map((abbr) => {
  const teamName = Object.entries(TEAM_ABBR).find(([, value]) => value === abbr)[0];
  return { abbr, name: teamName };
});

const venues = readCsv('venues.csv').map((row) => ({
  name: cleanName(row.venue_stadium),
  city: cleanName(row.city),
  homeTeam: cleanName(row.home_team),
}));

const overseasCount = players.filter((player) => player.overseas).length;
  const expectedPlayerCount = squadPlayerCount + auctionPoolPlayers.length;
  if (players.length !== expectedPlayerCount) {
    throw new Error(`Expected ${expectedPlayerCount} players, got ${players.length}`);
  }
if (teams.length !== 10) throw new Error(`Expected 10 teams, got ${teams.length}`);

const output = {
  meta: {
    season: 'IPL 2026',
    source: 'ipl dataset/squads.csv + deliveries.csv (deliveries canonical) + new_players.json (auction pool)',
    generatedAt: new Date().toISOString(),
    playerCount: players.length,
    squadPlayerCount,
    auctionPoolCount: auctionPoolPlayers.length,
    teamCount: teams.length,
    overseasCount,
    excludedPlayers: EXCLUDED_NAMES,
    league: Object.fromEntries(Object.entries(league).map(([key, value]) => [key, round(value, 4)])),
  },
  teams,
  venues,
  players,
};

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);

const priceCounts = players.reduce((counts, player) => {
  counts[player.basePriceLakh] = (counts[player.basePriceLakh] ?? 0) + 1;
  return counts;
}, {});

console.log(`Wrote ${OUT_FILE}`);
console.log(`Players: ${players.length} (${overseasCount} overseas) | Teams: ${teams.length}`);
console.log('Base price tiers:', Object.entries(priceCounts).sort((a, b) => b[0] - a[0]).map(([price, count]) => `${price}L x${count}`).join(', '));
console.log('Top rated:', ranked.slice(0, 8).map((player) => `${player.name} ${player.ratings.overall}`).join(' | '));
console.log('Top run scorers:', [...players].sort((a, b) => b.stats.batting.runs - a.stats.batting.runs).slice(0, 5).map((player) => `${player.name} ${player.stats.batting.runs}`).join(' | '));
console.log('Top wicket takers:', [...players].sort((a, b) => b.stats.bowling.wickets - a.stats.bowling.wickets).slice(0, 5).map((player) => `${player.name} ${player.stats.bowling.wickets}`).join(' | '));
if (unmatched.size > 0) {
  console.warn(`Unmatched delivery names (${unmatched.size}):`, [...unmatched.entries()].map(([name, count]) => `${name} (${count})`).join(', '));
}

const priorOnly = players.filter((player) => player.team !== 'FA' && player.stats.matches === 0);
  if (priorOnly.length > 0) {
    console.warn(
      `Squad players with no delivery data - ratings are priors only (${priorOnly.length}):`,
      priorOnly.map((player) => player.name).join(', '),
    );
  }
