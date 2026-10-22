import { Dialog, EmptyState } from './ui.jsx';
import { pluralize, roleLabel } from '../lib/format.js';

function BattingTable({ innings }) {
  const batted = innings.batting.filter((batsman) => batsman.didBat);
  const notBatted = innings.batting.filter((batsman) => !batsman.didBat);

  return (
    <div className="table-wrap">
      <table className="data-table score-table">
        <caption className="visually-hidden">Batting card for {innings.teamName}</caption>
        <thead>
          <tr>
            <th scope="col">Batter</th>
            <th scope="col" className="numeric">R</th>
            <th scope="col" className="numeric">B</th>
            <th scope="col" className="numeric">4s</th>
            <th scope="col" className="numeric">6s</th>
            <th scope="col" className="numeric">SR</th>
            <th scope="col">How out</th>
          </tr>
        </thead>
        <tbody>
          {batted.map((batsman) => (
            <tr key={batsman.id}>
              <td>
                {batsman.name}
                <span className="cell-note">{roleLabel(batsman.role)}</span>
              </td>
              <td className="numeric">{batsman.runs}</td>
              <td className="numeric">{batsman.balls}</td>
              <td className="numeric">{batsman.fours}</td>
              <td className="numeric">{batsman.sixes}</td>
              <td className="numeric">{batsman.strikeRate ?? 0}</td>
              <td>{batsman.out ? batsman.dismissal : 'not out'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {notBatted.length > 0 ? (
        <p className="table-note">Did not bat: {notBatted.map((batsman) => batsman.name).join(', ')}.</p>
      ) : null}
    </div>
  );
}

function BowlingTable({ innings }) {
  return (
    <div className="table-wrap">
      <table className="data-table score-table">
        <caption className="visually-hidden">Bowling card for {innings.teamName}</caption>
        <thead>
          <tr>
            <th scope="col">Bowler</th>
            <th scope="col" className="numeric">O</th>
            <th scope="col" className="numeric">R</th>
            <th scope="col" className="numeric">W</th>
            <th scope="col" className="numeric">Econ</th>
          </tr>
        </thead>
        <tbody>
          {innings.bowling.map((bowler) => (
            <tr key={bowler.id}>
              <td>{bowler.name}</td>
              <td className="numeric">{bowler.overs}</td>
              <td className="numeric">{bowler.runs}</td>
              <td className="numeric">{bowler.wickets}</td>
              <td className="numeric">{bowler.economy ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InningsBlock({ innings }) {
  return (
    <section className="scorecard-innings">
      <div className="scorecard-head">
        <h3>{innings.teamName}</h3>
        <p>
          {innings.runs}/{innings.wickets} in {innings.overs} overs · RR {innings.runRate}
        </p>
      </div>
      <BattingTable innings={innings} />
      <BowlingTable innings={innings} />
      {innings.fallOfWickets.length > 0 ? (
        <p className="table-note">
          Fall of wickets:{' '}
          {innings.fallOfWickets
            .map((fall) => `${fall.wicket}-${fall.runs} (${fall.batsman}, ${fall.over})`)
            .join(', ')}
          .
        </p>
      ) : null}
    </section>
  );
}

export default function ScorecardDialog({ match, onClose }) {
  if (!match) return null;
  const innings = match.innings ?? [];
  const attempts = match.superOver?.attempts ?? [];

  return (
    <Dialog
      open
      wide
      title={`${match.teamA.name} vs ${match.teamB.name}`}
      onClose={onClose}
    >
      <p className="scorecard-result">{match.resultText}</p>
      {innings.length === 0 ? (
        <EmptyState title="No scorecard.">This match has no innings data.</EmptyState>
      ) : (
        innings.map((entry) => <InningsBlock innings={entry} key={`${entry.teamId}-${entry.balls}`} />)
      )}

      {match.superOver ? (
        <section className="scorecard-superover">
          <h3>Super Over</h3>
          <p>{match.superOver.resultText}</p>
          <ul className="superover-list">
            {attempts.map((attempt, index) => (
              <li key={`${attempt.first.teamId}-${index}`}>
                Attempt {index + 1}: {attempt.first.teamName} {attempt.first.runs}/
                {attempt.first.wickets}, {attempt.second.teamName} {attempt.second.runs}/
                {attempt.second.wickets}.
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="table-note">
        {pluralize(innings.length, 'innings')} simulated from the seeded ball-by-ball model.
      </p>
    </Dialog>
  );
}
