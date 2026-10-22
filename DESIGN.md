# Design direction: The Auction Room

An editorial sports paper for a LAN cricket auction, running at night. The room
should feel like a printed match-day supplement after the lights go down: warm
charcoal stock, hard rules, serif headlines, and one cricket-green ink for the
action.

Dial: ENERGY 1 / RHYTHM 2 / MOTION 1.

## Identity

- Product name: The Auction Room
- Subtitle: IPL 2026 auction, played on the local network
- Voice: dry, specific, match-day confident. No marketing claims.
- Motif: newspaper masthead rules, boxed scores, stamped result labels.

## Palette

Night edition. Warm charcoal stock instead of paper; the print rules and
typography carry the identity.

- Paper `#14130f`: warm charcoal, easy on the eyes in a dark room.
- Ink `#f2ecdf`: headline and body text.
- Soft ink `#b8af9e`: secondary text.
- Rule `#3b352a`: 1px and 2px editorial rules, not borders on every surface.
- Cricket green `#74c49a`: the one accent, lifted for contrast on dark stock.
  Used for the bid action, focus, and live state. Dark ink on green passes AA.
- Auction red `#e68f83`: reserved for destructive actions and sold/error states.
- Team accent colours come from the ten-colour room palette. They are identity
  data, not part of the page palette.

## Typography

- Display: Newsreader, falling back to Iowan Old Style, Palatino, Georgia.
- UI and body: Public Sans, falling back to Segoe UI, system sans.
- Numbers use tabular figures. No monospace headings.
- Headlines are tight and large; labels are small caps with modest tracking.

## Layout

- A masthead with a double rule opens the page, like a sports supplement.
- Desktop uses an asymmetric three-column auction desk: teams, lot, wire.
- Cards are paper panels with rules and square corners at 2px radius.
- Buttons are rectangular, labelled, and at least 44px tall.
- The bid panel is the one elevated surface, because the bid is the decision.
- Mobile stacks the lot first, then teams, then the wire. The bid action stays
  reachable at the bottom of the viewport.

## Motion

- MOTION 1: hover and focus feedback, a timer bar, and a short result stamp.
- No looping pulses, floating cards, scroll reveals, or parallax.
- Respect `prefers-reduced-motion` and render the final state immediately.

## Theme

- Fixed dark night edition. Chosen by the owner; a light mode is not shipped.
