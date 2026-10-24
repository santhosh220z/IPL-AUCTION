import { useEffect, useRef, useState } from 'react';
import { PALETTE, normalizeRoomCode } from '../../../shared/constants.js';
import { Button, Field, Swatches } from './ui.jsx';

const TEAM_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 .'&_-]*$/;

function validateName(name) {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 24) return 'Team name must be 2 to 24 characters.';
  if (!TEAM_NAME_RE.test(trimmed)) {
    return 'Use letters, numbers, spaces, . _ & - or apostrophes.';
  }
  return '';
}

export default function Home({ initialCode = '', onCreate, onJoin, onPreview }) {
  const [mode, setMode] = useState(initialCode ? 'join' : 'create');
  const [teamName, setTeamName] = useState('');
  const [color, setColor] = useState('emerald');
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const nameRef = useRef(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (mode !== 'join' || code.trim().length !== 6) {
      setPreview(null);
      return undefined;
    }
    let active = true;
    const timer = setTimeout(async () => {
      const response = await onPreview(code.trim().toUpperCase());
      if (!active) return;
      setPreview(response.ok ? response.preview : null);
      if (!response.ok) return;
      setError((current) => (current === 'That room code has no open room.' ? '' : current));
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [mode, code, onPreview]);

  useEffect(() => {
    if (!preview?.takenColors?.includes(color)) return;
    const free = PALETTE.find((entry) => !preview.takenColors.includes(entry.id));
    if (free) setColor(free.id);
  }, [preview, color]);

  async function submit(event) {
    event.preventDefault();
    setError('');

    const nameError = validateName(teamName);
    if (nameError) {
      setError(nameError);
      return;
    }

    if (mode === 'join' && code.trim().length !== 6) {
      setError('Room code should be 6 characters.');
      return;
    }

    setBusy(true);
    const response =
      mode === 'create'
        ? await onCreate({ teamName: teamName.trim(), color })
        : await onJoin({ code: code.trim().toUpperCase(), teamName: teamName.trim(), color });
    setBusy(false);

    if (!response.ok) setError(response.error ?? 'That did not work. Try again.');
  }

  return (
    <main className="home">
      <section className="home-lead">
        <p className="home-dateline">Auction night, on your local network</p>
        <h1>The room is open.</h1>
        <p className="home-intro">
          An IPL auction for the people in the room. Two to ten teams, one purse, and a full
          tournament after the last hammer.
        </p>

        <div className="home-rules">
          <div className="rule-block">
            <h2>The auction</h2>
            <ul className="rule-list">
              <li>257 players from the IPL 2026 squads.</li>
              <li>₹120 Cr per team. 25-player squad. 8 overseas maximum.</li>
              <li>One lot at a time, timed on the server, with every bid on screen.</li>
              <li>Host can pause, skip a lot, or end the auction early.</li>
            </ul>
          </div>
          <div className="rule-block">
            <h2>The tournament</h2>
            <ul className="rule-list">
              <li>A seeded knockout bracket after the auction.</li>
              <li>Every match is simulated ball by ball from the IPL delivery data.</li>
              <li>Short squads can be filled at base price before the bracket is drawn.</li>
              <li>Ties go to a Super Over.</li>
            </ul>
          </div>
        </div>

        <p className="home-footnote">
          Ratings and base prices are generated from the IPL delivery data. No account is needed.
          Your team is restored when you refresh.
        </p>
      </section>

      <section className="home-panel" aria-labelledby="enter-room-title">
        <div className="home-panel-head">
          <p className="panel-number">Enter the room</p>
          <h2 id="enter-room-title">Pick a name. Pick a colour.</h2>
        </div>

        <div className="mode-switch" role="group" aria-label="Room action">
          <button
            type="button"
            className={mode === 'create' ? 'is-active' : ''}
            aria-pressed={mode === 'create'}
            onClick={() => {
              setMode('create');
              setError('');
            }}
          >
            Create a room
          </button>
          <button
            type="button"
            className={mode === 'join' ? 'is-active' : ''}
            aria-pressed={mode === 'join'}
            onClick={() => {
              setMode('join');
              setError('');
            }}
          >
            Join a room
          </button>
        </div>

        <form className="home-form" onSubmit={submit} aria-busy={busy}>
          {mode === 'join' ? (
            <Field label="Room code" htmlFor="room-code" hint="Six characters from the host.">
              <input
                id="room-code"
                className="input code-input"
                value={code}
                onChange={(event) => setCode(normalizeRoomCode(event.target.value))}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck="false"
                maxLength={6}
                aria-describedby="room-code-hint"
                required
              />
            </Field>
          ) : null}

          {mode === 'join' && preview ? (
            <p className="room-preview" role="status">
              Hosted by {preview.hostTeamName}. {preview.playerCount} of {preview.maxTeams} teams
              seated
              {preview.takenNames.length ? <> · names taken: {preview.takenNames.join(', ')}</> : null}.
            </p>
          ) : null}

          <Field label="Team name" htmlFor="team-name" hint="Case does not create a second team.">
            <input
              id="team-name"
              ref={nameRef}
              className="input"
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
              maxLength={24}
              autoComplete="off"
              aria-describedby="team-name-hint"
              required
            />
          </Field>

          <fieldset className="field field-set">
            <legend className="field-label">Accent colour</legend>
            <Swatches
              value={color}
              onChange={setColor}
              name="home-color"
              disabledColors={mode === 'join' && preview ? preview.takenColors : []}
            />
          </fieldset>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <Button type="submit" variant="accent" className="form-submit" disabled={busy}>
            {busy
              ? mode === 'create'
                ? 'Creating room...'
                : 'Joining room...'
              : mode === 'create'
                ? 'Create room'
                : 'Join room'}
          </Button>

          <p className="form-note">
            {mode === 'create'
              ? 'You become the host. Share the room code once the room opens.'
              : 'The host starts the auction when every team is in.'}
          </p>
        </form>
      </section>
    </main>
  );
}
