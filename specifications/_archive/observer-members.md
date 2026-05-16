# Spec: Observer Members (v0 only)

## Problem

The pool is built around a single dinner-stake leaderboard: top half eats, bottom half pays.
A handful of friends want to play along — submit predictions, follow the bracket, enjoy the
drama — but **without committing to the dinner**. Today the only way to opt them in is to
add them as regular players, which silently changes the dinner-split math (`N` grows, the
cutoff `T` shifts) and either dilutes the stakes or forces them into a financial commitment
they didn't agree to.

We want a way to admit "observers": friends who can submit predictions and watch the
tournament alongside everyone else, but who sit **outside the dinner pool**.

## Goal

- Introduce an `is_observer` flag on players. Observers participate fully in submitting
  predictions, podium, and bracket; they show up in everyone's prediction views; their PIN
  flow is identical.
- They are **excluded from the dinner-split leaderboard** and from the cutoff math (`N` and
  `T` are computed over non-observers only).
- They appear in a **separate "Observadores" leaderboard** alongside the main one (never
  blended into it), ranked the same way (golf-style, total ascending, exacts as tiebreak),
  but with no dinner-split shading and no podium / locked-half indicators.
- Observers are visually flagged with 👀 next to their name everywhere their name appears.

**Scope: v0 only.** The public edition (`goalgut/` sibling) handles this differently —
multi-tenancy with league-level roles. See `ROADMAP.md`. Do not port this implementation
forward.

---

## User-facing behaviour

### Identity and submissions

Observers are identical to regular players for every write path:

- Same PIN-based login flow (`state.viewerPlayerId`, `localStorage`)
- Can submit group-stage score predictions via the same form
- Can submit podium predictions
- Can submit bracket picks
- Same Edge Functions handle their submissions; no auth changes
- Same submission deadline applies

The boolean is **purely a display / leaderboard-grouping concern**. No write path checks it.

### Visibility, both directions

Post-deadline, everyone sees everyone's predictions, including:

- Regular players see observer predictions in the Predictions tab
- Observers see regular-player predictions in the Predictions tab
- Same for podium and bracket views (where they exist)

Pre-deadline, same rules as today: each player sees only their own. The observer flag
doesn't change pre/post-deadline reveal semantics — it only changes the leaderboard
grouping and the 👀 badge.

### Where the 👀 badge appears

Render `👀 ` immediately before the player's name (no text label) anywhere the name is
displayed to other viewers:

- Predictions tab — player headers and any per-player rows
- Leaderboard tab — both the main (Classificação) and the Observadores sections
- Matches tab — wherever per-player predictions are listed
- Anywhere else a player's name appears in render output

The viewer themself sees their own name without the badge in headers like "As tuas
previsões" — but if the viewer is an observer and their own row appears in the Observadores
leaderboard, the badge is still shown there (consistency).

### Leaderboard layout

When the leaderboard tab becomes visible (per `leaderboard-v0-dinner-split.md`'s gate),
render it as two **fully separate** sections, in order. Observer rows never appear in the
main section, regardless of their total or how few/many observers there are.

```
┌──────────────────────────────────────────┐
│ Classificação                 [chart]    │  ← all the green/red, locks, podium math
│   1. 🥇 Alice           42 pts           │     from leaderboard-v0-dinner-split.md
│   2. 🥈 Bob             45 pts           │     applies to this section only
│   ...                                    │     no observers in this list
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│ Observadores                  [chart]    │  ← plain ranked list + its own chart
│   1.   Carla            38 pts           │     no green/red shading
│   2.   Dani             51 pts           │     no locked-half badges
│   ...                                    │     no Possível: # range
└──────────────────────────────────────────┘
```

The Observadores section is hidden entirely if there are zero observers in the pool. The
section header is the plain word `Observadores` — no 👀 emoji on the header (the badge is
already on each observer row's name).

### Cumulative-points chart

Same "always separate" rule applies: render **two charts**, one per section, each above
its own ranked list. The main chart contains non-observer lines only; the Observadores
chart contains observer lines only. Both use the same Chart.js setup (same axes, same
tooltip behaviour, same colour palette logic) — the only difference is the dataset filter.

This is more deliberate than blending and a dashed-line convention, and it matches the
principle that the two pools never mix. If the Observadores section is hidden (zero
observers), its chart is hidden too.

### Dinner-split math — observers excluded

The formula from `leaderboard-v0-dinner-split.md` applies to **non-observer rows only**:

- `N` = number of regular (non-observer) players
- `T = Math.floor(N / 2)`

Example: 10 regulars + 3 observers. `N = 10`, `T = 5`. Top 5 of the 10 eat; bottom 5 pay.
The 3 observers are listed separately and have no bearing on T.

If `N < 2` (e.g. all players are observers), the dinner section renders an empty-state
("Sem classificação — só observadores.") and the locking math is skipped.

### Ranking inside the Observadores section

Same sort as the main leaderboard:

- Primary: `total` ascending (golf, lower is better)
- Tiebreak: `exacts` descending

No medals (🥇🥈🥉), no green/red dinner shading, no Possível range, no locked-half badges,
no podium-prediction collapsed details. Just rank, 👀 name, total, exacts. Keep it simple —
the dinner is the stake those highlights symbolise, and observers aren't competing for it.

### "Just another player" in every other surface

Outside the leaderboard tab, observers are indistinguishable from regular players except for
the 👀 badge. Their predictions appear in the same lists, in the same order, with the same
expand-on-click affordances. Their data is in the same `predictions`, `podium_predictions`,
and `bracket_predictions` tables.

---

## Data model

### Schema change

Add a single boolean column to the existing `players` table:

```sql
alter table players
  add column is_observer boolean not null default false;
```

The `not null default false` ensures existing players are automatically marked as
non-observers — no backfill query needed. New player rows default to non-observer too;
making someone an observer is an explicit admin action.

### No other schema changes

- `predictions`, `podium_predictions`, `bracket_predictions` — unchanged. Observer
  predictions live in the same tables; the join via `player_id` already carries the
  observer flag through.
- `tournament_config` — unchanged.
- No new tables, no new RLS policies.

### Reads

The frontend already loads the full `players` list at boot. Extend the existing select to
include `is_observer`:

```js
// wherever sbGet("players", "select=*") or similar runs at boot
// no change needed if select=* is already used (it is — see fetchAll at ~index.html:383)
```

`select=*` already pulls every column, so no client query change is required after the
column is added. Each player record on the frontend will carry `.is_observer` automatically.

---

## Edge Function changes

**None.** All four Edge Functions (`get-predictions`, `submit-predictions`,
`submit-bracket`, `change-pin`) continue to work unchanged. They authenticate by PIN against
`players.code` — the new column is irrelevant to that flow. Observers submit and read the
same way regulars do.

This is deliberate: the boolean is a frontend-only grouping concern. Pushing it into the
Edge Function would entangle write semantics with display concerns and make a future
"promote observer to regular" admin action awkwardly server-side.

---

## Admin model

Toggling `is_observer` is **admin-only**, performed via direct DB edit in the Supabase
dashboard:

```sql
update players set is_observer = true where name = 'Carla';
```

No UI for self-toggling, no Edge Function for it. This matches how players are added
today (manual seeding).

**Reversibility.** In practice, `is_observer` is set-once per tournament from the player's
perspective. Mid-tournament toggling is not exposed in any UI. It is technically possible
via direct DB edit, but doing so mid-tournament has subtle consequences:

- Promoting an observer to regular mid-tournament shifts `N` and `T`, which can flip
  locked-half classifications for other players. Avoid.
- Demoting a regular to observer mid-tournament removes them from the dinner pool, which
  the group may experience as broken commitment. Avoid.

The admin guidance is: **set this flag before the submission deadline, then leave it
alone**. No code-level enforcement — just a discipline.

---

## Implementation notes

### Files touched

- `index.html` — most of the work: badge rendering, leaderboard partitioning, chart legend.
- One SQL migration applied directly in Supabase (not committed; we don't track migrations
  in this repo — match the pattern of prior schema changes).
- No Edge Function changes.
- No GitHub Actions / fetch-results changes.

### Where the logic lives

- **Player record extension**: no code change needed — `select=*` already returns the new
  column. Verify after the migration that `state.players[i].is_observer` is populated.
- **👀 badge rendering**: add a helper `playerLabel(p)` that returns `\`👀 ${p.name}\``
  when `p.is_observer`, else `p.name`. Replace direct `p.name` references in render
  functions with `playerLabel(p)`. Audit:
  - `renderPredictions()`
  - `renderLeaderboard()`
  - `renderMatches()` (per-player prediction rows, if any)
  - Any other surface that prints a player name
- **Leaderboard split**: in `renderLeaderboard()` (~`index.html:1283`), partition the
  computed `lb` array into two arrays — `mainLb` (non-observers) and `obsLb` (observers).
  Apply the dinner-split spec (`leaderboard-v0-dinner-split.md`) to `mainLb` only. Render
  `obsLb` below under its own `Observadores` header as a plain ranked list. Observer rows
  must never appear in `mainLb`, even transiently.
- **Cumulative-points chart**: in the chart-init block (~`index.html:1781`), build two
  Chart.js instances — one fed by `mainLb` players, one fed by `obsLb` players. Same
  options object for both. The second chart's container is mounted just above the
  `Observadores` ranked list. Skip the second chart entirely when `obsLb` is empty.
- **Empty-state handling**:
  - `obsLb.length === 0` → render neither the Observadores chart nor the Observadores
    section.
  - `mainLb.length < 2` → render the Classificação header with an empty-state message
    ("Sem classificação — só observadores.") and skip the dinner shading/locking entirely.
    The Observadores section still renders normally beneath.

### CSS additions

```css
.lb-section-header { font-size: 12px; font-weight: 700; text-transform: uppercase;
                     letter-spacing: 0.08em; opacity: 0.7; margin: 16px 0 8px; }
.lb-row--observer { /* plain, no green/red */ background: rgba(255,255,255,0.02);
                    border-left: 2px solid transparent; }
```

The observer rows deliberately avoid `.half-top` / `.half-bottom` / `.locked-*` from the
dinner-split spec.

### Order of work

1. Run the SQL migration in Supabase (`alter table players add column is_observer
   boolean not null default false;`).
2. Verify in the frontend console that `state.players[0].is_observer === false` after a
   reload.
3. Add `playerLabel(p)` helper and replace name references.
4. Partition `lb` in `renderLeaderboard()` and add the Observadores section.
5. Add the second (Observadores) chart, fed by `obsLb`. Skip when `obsLb` is empty.
6. Mark a test account as observer in the DB and walk through the full flow:
   submit → leaderboard layout → chart → predictions tab.

This sequencing assumes the dinner-split spec
(`specifications/_archive/leaderboard-v0-dinner-split.md`) is implemented **first** or in parallel.
The Observadores section piggybacks on `lb` partitioning, which only makes sense once the
main-section logic exists.

---

## Out of scope

- Observer self-service signup or self-promotion to regular. Admin-only, by design.
- Per-observer settings (e.g. "join chart but not the Observadores leaderboard"). One flag,
  one behaviour.
- Carrying this to v1 (`goalgut/`). The public edition will model this through league-
  member roles, not a player-level boolean.
- Observer-only Excel export, observer-only badges in the matches tab beyond the name
  prefix, or other surfaces. Keep the cosmetic footprint small.
- An audit log of who flipped the flag when. Not needed for a closed friend group.

## Open questions

- **Observadores ordering when empty of group-stage data** — pre-first-kickoff the
  leaderboard tab is hidden anyway (per `leaderboard-v0-dinner-split.md`), so this
  shouldn't come up. Confirm.
