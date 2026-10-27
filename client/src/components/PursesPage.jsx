import { useState } from 'react';
import { formatLakh } from '../../../shared/constants.js';
import { formatNumber, pluralize, roleLabel } from '../lib/format.js';
import { Button, Dialog, EmptyState, TeamMark } from './ui.jsx';

function SquadDialog({ team, settings, onClose }) {
  if (!team) return null;
  const spent = team.squad.reduce((sum, player) => sum + player.priceLakh, 0);
  return (
    <Dialog open title={`${team.teamName} squad`} onClose={onClose} wide>
      <div className="squad-summary">
        <p>
          {team.squadCount} {pluralize(team.squadCount, 'player')} bought · {formatLakh(spent)} spent ·{' '}
          {formatLakh(team.purseLakh)} left
        </p>
        <p>
          {team.overseasCount} overseas. Squad limit is {settings?.maxSquad}, with{' '}
          {settings?.maxOverseas} overseas.
        </p>
      </div>
      {team.squad.length === 0 ? (
        <EmptyState title="No players yet.">This team has not won a lot.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">Players bought by {team.teamName}</caption>
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
    </Dialog>
  );
}

export default function PursesPage({ snapshot, onBack }) {
  const { teams, settings, code, youId } = snapshot;
  const [squadTeamId, setSquadTeamId] = useState(null);

  function handleBack() {
    if (onBack) onBack();
  }

  return (
    <main className="purses-page">
      <header className="purses-header">
        <Button variant="quiet" onClick={handleBack} className="back-btn">
          ← Back to Auction
        </Button>
        <div className="purses-title">
          <p className="page-kicker">Room {code}</p>
          <h1>Team Purses</h1>
        </div>
      </header>

      <section className="purses-list" aria-labelledby="purses-title">
        <div className="section-head">
          <h2 id="purses-title">Purses & Squad Status</h2>
          <span className="section-note">{teams.length} teams · {formatLakh(settings.purseLakh)} purse each</span>
        </div>
        <ul className="purse-rows">
          {teams.map((team) => (
            <li className="purse-row" key={team.id}>
              <TeamMark name={team.teamName} color={team.color} size="small" />
              <div className="purse-row-body">
                <p className="purse-row-name">
                  {team.teamName}
                  {team.id === youId ? <span className="row-tag">You</span> : null}
                </p>
                <p className="purse-row-meta">
                  {formatLakh(team.purseLakh)} remaining · {team.squadCount}/{settings.maxSquad} players ·{' '}
                  {team.overseasCount}/{settings.maxOverseas} overseas
                </p>
              </div>
              <Button
                variant="quiet"
                className="row-action"
                aria-label={`View ${team.teamName} squad`}
                onClick={() => setSquadTeamId(team.id)}
              >
                Squad
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <SquadDialog team={teams.find((t) => t.id === squadTeamId)} settings={settings} onClose={() => setSquadTeamId(null)} />
    </main>
  );
}