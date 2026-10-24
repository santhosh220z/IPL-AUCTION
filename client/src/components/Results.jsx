import { useEffect, useState } from 'react';
import { formatLakh, parseSeed as parseSeedRaw } from '../../../shared/constants.js';
import { formatNumber, formatSeed, pluralize, roleLabel } from '../lib/format.js';
import { Button, EmptyState, Field, Stat, TeamMark } from './ui.jsx';
import ScorecardDialog from './ScorecardDialog.jsx';

function parseSeedText(text) {
  const parsed = parseSeedRaw(text);
  return parsed.error ? { error: parsed.error } : { seed: parsed.seed };
}

function spentBy(team) {
  return team.squad.reduce((sum, player) => sum + player.priceLakh, 0);
}

function MatchCard({ match, onOpen }) {
  const innings = match.innings ?? [];

  return (
    <article className="match-card" aria-label={`${match.teamA.name} versus ${match.teamB.name}`}>
      <div className="match-card-head">
        <p className="match-name">{match.name ?? 'Match'}</p>
        {match.superOver ? <span className="match-badge">Super Over</span> : null}
      </div>
      <div className="match-teams">
        {[match.teamA, match.teamB].map((team) => {
          const entry = innings.find((inningsEntry) => inningsEntry.teamId === team.id);
          const winner = match.winnerId === team.id;
          return (
            <div className={winner ? 'match-team is-winner' : 'match-team'} key={team.id}>
              <TeamMark name={team.name} color={team.color} size="small" />
              <span className="match-team-name">{team.name}</span>
              <span className="match-score">
                {entry ? `${entry.runs}/${entry.wickets}` : '-'}
              </span>
              <span className="match-overs">{entry ? `${entry.overs} ov` : ''}</span>
              {winner ? <span className="match-won">Won</span> : null}
            </div>
          );
        })}
      </div>
      <p className="match-result">{match.resultText}</p>
      <Button variant="quiet" className="match-action" onClick={() => onOpen(match)}>
        Scorecard
      </Button>
    </article>
  );
}

function TeamSquads({ teams }) {
  return (
    <section className="results-squads" aria-labelledby="results-squads-title">
      <div className="section-head">
        <h2 id="results-squads-title">Final squads</h2>
        <span className="section-note">Auction prices</span>
      </div>
      {teams.map((team) => (
        <details className="squad-details" key={team.id}>
          <summary>
            <TeamMark name={team.teamName} color={team.color} size="small" />
            <span className="squad-details-name">{team.teamName}</span>
            <span className="squad-details-meta">
              {team.squadCount} {pluralize(team.squadCount, 'player')} ·{' '}
              {formatLakh(spentBy(team))} spent
            </span>
          </summary>
          {team.squad.length === 0 ? (
            <EmptyState title="No players.">This team did not buy anyone.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <caption className="visually-hidden">Squad for {team.teamName}</caption>
                <thead>
                  <tr>
                    <th scope="col">Player</th>
                    <th scope="col">Role</th>
                    <th scope="col" className="numeric">
                      Rating
                    </th>
                    <th scope="col" className="numeric">
                      Price
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {team.squad.map((player) => (
                    <tr key={player.playerId}>
                      <td>
                        {player.name}
                        {player.overseas ? <span className="cell-note">Overseas</span> : null}
                      </td>
                      <td>{roleLabel(player.role)}</td>
                      <td className="numeric">{formatNumber(player.overall)}</td>
                      <td className="numeric">{formatLakh(player.priceLakh)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      ))}
    </section>
  );
}

function SeedControl({ seed, onSeed }) {
  return (
    <details className="seed-disclosure">
      <summary>Set a draw seed</summary>
      <Field
        label="Draw seed"
        htmlFor="draw-seed"
        hint="A whole number makes the draw repeatable. Leave it blank for a random seed."
      >
        <input
          id="draw-seed"
          className="input"
          value={seed}
          onChange={(event) => onSeed(event.target.value.replace(/[^0-9]/g, ''))}
          inputMode="numeric"
          autoComplete="off"
          placeholder="Random"
          aria-describedby="draw-seed-hint"
        />
      </Field>
    </details>
  );
}

function TournamentView({ simulation, teams, isHost, seed, setSeed, onRun, onLeave, busy, notify }) {
  const [scorecard, setScorecard] = useState(null);
  const invalidTeams = simulation.teams.filter((team) => !team.validXI);

  useEffect(() => {
    setScorecard(null);
  }, [simulation.generatedAt]);

  async function runAgain() {
    const parsed = parseSeedText(seed);
    if (parsed.error) {
      notify(parsed.error, 'error');
      return;
    }
    const response = await onRun(parsed.seed);
    if (!response.ok) notify(response.error ?? 'The tournament did not run.', 'error');
  }

  return (
    <>
      <section className="results-hero" aria-labelledby="champion-title">
        <p className="page-kicker">
          Tournament complete · Seed {formatSeed(simulation.seed)} · {simulation.matchCount}{' '}
          {pluralize(simulation.matchCount, 'match', 'matches')}
        </p>
        <h1 id="champion-title">{simulation.champion?.name ?? 'The champion'} takes the title.</h1>
        <p className="results-lede">
          {simulation.runnerUp ? `${simulation.runnerUp.name} finished second.` : ''}
          {simulation.third ? ` ${simulation.third.name} finished third.` : ''}
        </p>
        <div className="podium">
          {[
            ['Champion', simulation.champion],
            ['Runner-up', simulation.runnerUp],
            ['Third', simulation.third],
          ]
            .filter(([, team]) => team)
            .map(([label, team]) => (
              <div className="podium-place" key={label}>
                <span className="podium-label">{label}</span>
                <TeamMark name={team.name} color={team.color} />
                <span className="podium-name">{team.name}</span>
              </div>
            ))}
        </div>
      </section>

      {invalidTeams.length > 0 ? (
        <p className="callout is-warning" role="status">
          These teams could not field a legal XI from their squad:{' '}
          {invalidTeams.map((team) => team.name).join(', ')}. The simulation used the closest
          available lineup.
        </p>
      ) : null}

      <section className="bracket" aria-labelledby="bracket-title">
        <div className="section-head">
          <h2 id="bracket-title">The bracket</h2>
          <span className="section-note">
            {simulation.rounds.length} {pluralize(simulation.rounds.length, 'round')}
          </span>
        </div>
        <div className="bracket-scroll">
          <div className="bracket-rounds">
            {simulation.rounds.map((round) => (
              <div className="bracket-round" key={round.round}>
                <h3 className="bracket-round-name">{round.name}</h3>
                <div className="bracket-matches">
                  {round.matches.length === 0 ? (
                    <p className="bracket-empty">Byes only.</p>
                  ) : (
                    round.matches.map((match) => (
                      <MatchCard match={match} key={match.id} onOpen={setScorecard} />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {simulation.thirdPlaceMatch ? (
          <div className="third-place">
            <div className="section-head">
              <h2>Third place</h2>
              <span className="section-note">Played before the final</span>
            </div>
            <MatchCard match={simulation.thirdPlaceMatch} onOpen={setScorecard} />
          </div>
        ) : null}
      </section>

      {isHost ? (
        <section className="host-panel results-host" aria-labelledby="run-again-title">
          <div className="section-head">
            <h2 id="run-again-title">Run it again</h2>
            <span className="section-note">Host only</span>
          </div>
          <p className="settings-copy">
            A new seed redraws the bracket. The squads stay the same.
          </p>
          <SeedControl seed={seed} onSeed={setSeed} />
          <div className="host-button-grid">
            <Button variant="accent" onClick={runAgain} disabled={busy}>
              {busy ? 'Simulating...' : 'Simulate again'}
            </Button>
            <Button variant="quiet" onClick={onLeave}>
              Leave room
            </Button>
          </div>
        </section>
      ) : (
        <div className="results-footer">
          <p className="settings-copy">The host can run another draw from this room.</p>
          <Button variant="quiet" onClick={onLeave}>
            Leave room
          </Button>
        </div>
      )}

      <TeamSquads teams={teams} />

      <ScorecardDialog match={scorecard} onClose={() => setScorecard(null)} />
    </>
  );
}

export default function Results({ snapshot, isHost, onFillSquads, onRunSimulation, onLeave, notify }) {
  const { auction, teams, simulation } = snapshot;
  const [seed, setSeed] = useState('');
  const [fillBusy, setFillBusy] = useState(false);
  const [runBusy, setRunBusy] = useState(false);

  const shortTeams = teams.filter((team) => team.squadCount < 11);
  const soldCount = teams.reduce((sum, team) => sum + team.squadCount, 0);
  const spent = teams.reduce((sum, team) => sum + spentBy(team), 0);
  const unsold = auction?.unsoldPlayers ?? [];

  async function fill() {
    setFillBusy(true);
    const response = await onFillSquads();
    setFillBusy(false);
    if (!response.ok) {
      notify(response.error ?? 'The short squads were not filled.', 'error');
    } else {
      const unmatched = response.shortTeams?.length ?? 0;
      notify(
        `${response.filled} ${pluralize(response.filled, 'player')} added across ${response.teams} ${pluralize(
          response.teams,
          'team',
        )}.${unmatched > 0 ? ` ${unmatched} ${pluralize(unmatched, 'team')} still below 11 and would be disqualified.` : ''}`,
        'info',
      );
    }
  }

  async function run() {
    const parsed = parseSeedText(seed);
    if (parsed.error) {
      notify(parsed.error, 'error');
      return;
    }
    setRunBusy(true);
    const response = await onRunSimulation(parsed.seed);
    setRunBusy(false);
    if (!response.ok) notify(response.error ?? 'The tournament did not run.', 'error');
  }

  if (simulation) {
    return (
      <main className="results">
        <TournamentView
          simulation={simulation}
          teams={teams}
          isHost={isHost}
          seed={seed}
          setSeed={setSeed}
          onRun={onRunSimulation}
          onLeave={onLeave}
          busy={runBusy}
          notify={notify}
        />
      </main>
    );
  }

  return (
    <main className="results">
      <section className="results-head">
        <p className="page-kicker">Auction complete</p>
        <h1>The squads are set.</h1>
        <p className="results-lede">
          Fill any short squads, then draw the bracket. Every match is simulated ball by ball from
          the IPL delivery data.
        </p>
      </section>

      <div className="summary-strip">
        <Stat label="Players sold" value={soldCount} note={`${auction?.unsoldCount ?? 0} unsold`} />
        <Stat label="Money spent" value={formatLakh(spent)} note="Auction prices" />
        <Stat label="Teams" value={teams.length} note={`${shortTeams.length} below 11`} />
        <Stat label="Auction pool" value={auction?.totalCount ?? 0} note="Lots offered" />
      </div>

      {shortTeams.length > 0 ? (
        <section className="readiness-panel is-warning" aria-labelledby="readiness-title">
          <h2 id="readiness-title">Short squads</h2>
          <p>
            {shortTeams.map((team) => `${team.teamName} (${team.squadCount})`).join(', ')}{' '}
            {shortTeams.length === 1 ? 'has' : 'have'} fewer than 11 players. The XI needs 11.
          </p>
          {isHost ? (
            <>
              <Button variant="accent" onClick={fill} disabled={fillBusy || unsold.length === 0}>
                {fillBusy ? 'Filling squads...' : 'Fill squads'}
              </Button>
              <p className="action-note">
                {unsold.length === 0
                  ? `No unsold players left. ${shortTeams
                      .map((team) => team.teamName)
                      .join(', ')} cannot reach 11 and would be disqualified from the tournament.`
                  : 'Adds the cheapest unsold players at base price until each squad has 11. Teams left short are disqualified.'}
              </p>
              {teams.length - shortTeams.length >= 2 ? (
                <>
                  <SeedControl seed={seed} onSeed={setSeed} />
                  <Button variant="accent" onClick={run} disabled={runBusy}>
                    {runBusy ? 'Simulating...' : 'Run tournament anyway'}
                  </Button>
                  <p className="action-note">
                    Teams below 11 sit out the tournament. The complete squads play.
                  </p>
                </>
              ) : null}
            </>
          ) : (
            <p className="action-note">Waiting for the host to fill the short squads.</p>
          )}
        </section>
      ) : (
        <section className="readiness-panel" aria-labelledby="readiness-title">
          <h2 id="readiness-title">Ready for the draw</h2>
          <p>Every team has at least 11 players. The bracket can be drawn.</p>
          {isHost ? (
            <>
              <SeedControl seed={seed} onSeed={setSeed} />
              <Button variant="accent" onClick={run} disabled={runBusy}>
                {runBusy ? 'Simulating...' : 'Run tournament'}
              </Button>
              <p className="action-note">The draw is random unless you set a seed.</p>
            </>
          ) : (
            <p className="action-note">Waiting for the host to run the tournament.</p>
          )}
        </section>
      )}

      <TeamSquads teams={teams} />

      {unsold.length > 0 ? (
        <details className="unsold-details">
          <summary>
            {unsold.length} unsold {pluralize(unsold.length, 'player')}
          </summary>
          <ul className="name-list">
            {unsold.map((player) => (
              <li key={player.id}>
                {player.name} <span className="cell-note">{roleLabel(player.role)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="results-footer">
        <p className="settings-copy">Leaving the room keeps the auction closed for everyone else.</p>
        <Button variant="quiet" onClick={onLeave}>
          Leave room
        </Button>
      </div>
    </main>
  );
}
