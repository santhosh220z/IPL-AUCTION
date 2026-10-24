# IPL Auction Simulator

LAN multiplayer IPL auction plus a post-auction knockout simulation.
React + Vite client, Node/Express + Socket.IO server, in-memory rooms.
No login, no bots, no database. Server restart ends active rooms.

`ipl dataset/` is raw input and must not be edited. The generated game
dataset is `server/data/players.json`, rebuilt by `npm run data:build`.

## Commands

- `npm install` - install client, server, and root dependencies
- `npm run dev` - server :3001 + Vite :5173 (proxies /socket.io)
- `npm run lan` - build client, serve on :3001, print the LAN URL
- `npm run data:build` - rebuild players.json from `ipl dataset/`
- `npm test` - Vitest
- Single test: `npm test -w server -- auction.test -t "raises"`

Note: `ipl dataset/` contains a space; quote it in shell commands.
On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

## Data rules

- `deliveries.csv` is the canonical match source. `matches.csv` (39 of 74
  matches), `points_table.csv` (mid-season), and `*_stats.csv` (top-15
  snapshot) are partial and contradict deliveries. Never build ratings,
  results, or standings from them.
- Auction pool comes from `squads.csv`: 257 players. Normalize roles,
  nationality, and names in the data build script.
- Name aliases live in `scripts/player-aliases.json`; add fixes there, not
  inline. Three delivery players are not in squads and are excluded from
  the auction: Dilshan Madushanka, George Linde, Krish Bhagat.
- Base prices and ratings are generated from deliveries; never hand-edit
  `players.json`.
- Money is integer lakhs everywhere (Rs 120 Cr = 12000). Format only at the
  UI edge; never use floating-point crore values.

## Non-obvious rules

- Server is authoritative for bids, timers, purse, squad/overseas limits,
  sales, and simulation. The client never computes outcomes.
- Raise options are fixed at +1L/+25L/+50L/+1Cr over the current bid
  (`BID_RAISE_LAKH`, revalidated server-side); the first bid equals base
  price. No self-outbid. Every bid resets the timer.
- Room codes: 6 uppercase chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
- Team names are case-insensitively unique; accent colors are unique per
  room; max 10 teams.
- Joins are lobby-only. Refresh reconnects with a localStorage token, not a
  new join. Host transfers after 60s offline.
- Auction state machine: lobby -> auction -> ended. Pause freezes remaining
  milliseconds; host can skip the current player or end the auction.
- Simulation is a seeded statistical Monte Carlo ball-by-ball model. XI:
  11 players, max 4 overseas, at least 1 keeper, at least 5 bowling
  options; bowlers max 4 overs. Ties go to a super over.
- Bracket size is the next power of two; byes fill the gap; random draw, and the
  shuffle is re-drawn for every round (by design: fresh pairings each round, no
  fixed bracket skeleton). Semifinal losers play a 3rd-place match; 2-team rooms
  play only a final.
- If a squad has fewer than 11 players at auction end, the host's "Fill
  squad" action adds the cheapest unsold players at base price.

## Skills

Load skills with the `skill` tool when their trigger applies; do not load
everything at once.

- UI/design: `antislop` and `antislop-ui` before building or editing UI.
  Add `antislop-human` for accessibility and `ui-ux-pro-max` for palettes,
  typography, and interaction patterns.
- Polish/motion: `emil-design-eng` for UI feel; `review-animations` for
  animation review.
- Greenfield pages or redesigns: `hallmark`; use `web-design-guidelines`
  for audits and `design-system` for tokens.
- Coding: `ponytail` for the simplest working solution. Use
  `test-driven-development` before features and fixes.
- Debugging: `systematic-debugging` before proposing a fix.
- Completion: `verification-before-completion` before claiming anything is
  done or passing.
- Review: `code-review` for diffs/PRs; `ponytail-review` for
  over-engineering.
- Architecture/planning: `codebase-design`, `improve-codebase-architecture`,
  and `writing-plans` for multi-step work.
- Navigation: use `graphify` only after `graphify-out/` exists. It has not
  been generated yet, so do not query it today.

## Deploy

Same codebase serves LAN nights (`npm run lan` on a PC) and internet play.
Internet host: Render free tier per `render.yaml` (WebSocket-capable, Node).
`/api/lan` returns the origin the visitor actually used (`trust proxy` reads
`X-Forwarded-Proto`); `PUBLIC_URL` overrides when a host proxies badly.
Free instances sleep ~15 min idle and restart with empty rooms - rooms are
in-memory, so a woken server answers `room:rejoin` with "room no longer
exists" and the client toasts that. Never add docker/CDN config; `npm
start` alone serves the built client, `/api`, and Socket.IO.

## Verify

- Run `npm test` after logic changes; run `npm run build` before LAN tests.
- Manual check: two browser tabs, join, bid, refresh/reconnect, pause/skip,
  sold/unsold, bracket simulation.
- No lint or typecheck is configured; do not invent commands.
