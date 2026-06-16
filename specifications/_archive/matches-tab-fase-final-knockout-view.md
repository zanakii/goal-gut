# Spec: Matches tab — Fase Final knockout view (v0 only)

## Problem

Once the group stage ends, the Matches tab freezes. It renders only the 72 group fixtures
(`renderMatches`, `index.html:1251`), so through the entire knockout stage — the most-watched
half of the tournament — the tab is a static record of games already played, while the results
that actually move the leaderboard (podium picks resolving) happen elsewhere with no home here.

There's also a latent bug waiting for the first seeded knockout row. The main list builds from
`filtered = state.matches.filter(...)` (`index.html:1258`) with no group-vs-knockout
distinction, so a knockout row (`group_letter` like `R32`) would render **twice**: once
mislabeled "Grupo R32" in the main flow (`index.html:1280-1281`, `"Grupo " + grp`), and once in
the existing bottom "Fase Eliminatória" block (`index.html:1315-1351`). The moment knockout rows
are seeded, every KO game double-renders.

## Goal

- **Give the knockouts their own filter tab — "Fase Final" — alongside "Todos" and the group
  letters.** Selecting it shows the knockout games grouped by stage; it replaces the
  bottom-of-page "Fase Eliminatória" block entirely.
- **Default to Fase Final once the group stage ends**, so opening the Matches tab during the
  knockouts lands on live action, not a frozen group list.
- **Show KO games as read-only results, only once they're live or finished** — no upcoming-fixture
  clutter, no predictions (v0 doesn't predict KO scorelines).
- **Kill the double-render.** The group views (Todos + letters) show group matches only;
  knockouts live solely under Fase Final.

**Scope: v0 only.** Pairs with `post-group-stage-podium-bar-chart.md` (the bar chart owns the
*scoring* story of the knockouts; this owns the *fixtures* story). The podium-elimination
computation is the separate follow-up spec.

---

## Behaviour

### The filter row

Today the group-filter row is `[Todos] [A] [B] … [L]` (`index.html:1276-1279`). Add a **Fase
Final** button at the end of the row:

```
[Todos] [A] [B] … [L] [Fase Final]
```

Use a sentinel `groupFilter` value `"FINAL"` (group letters are single chars, so no collision).
The button renders only when `groupStageComplete` — before then there are no knockouts to show
and the tab would be dead weight.

### Default selection after the group stage

The effective filter is computed at render time so the default flips automatically without
clobbering an explicit choice:

```js
const effectiveFilter = (groupStageComplete && !state.groupFilterTouched)
  ? "FINAL"
  : state.groupFilter;
```

- Before group stage complete → `state.groupFilter` (initial `"all"`), unchanged.
- After complete, untouched → `"FINAL"` (the new default).
- Any group-button click sets `groupFilterTouched: true`, so the user's pick (including going
  back to "Todos") sticks for the session. A fresh page load resets the flag → Fase Final
  defaults again, which is what we want post-group-stage.

The `active` highlight compares each button to `effectiveFilter`, so Fase Final shows selected by
default.

### What each filter shows

| `effectiveFilter` | Main area |
|-------------------|-----------|
| `"all"` (Todos) | All **group** matches, grouped by group letter (today's behaviour) |
| `"A"`…`"L"` | That group's matches (today's behaviour) |
| `"FINAL"` (Fase Final) | **Knockout** matches, grouped by stage — see below |

"Todos" stays group-stage-only; the knockouts are deliberately a separate phase under their own
tab, not folded into "Todos". This is also what fixes the double-render — group views never
include KO rows. The main-list filter gains a group-only guard:

```js
// group views only ever see group matches
if (!(m.group_letter && m.group_letter.length === 1)) return false;
```

### Fase Final view

Render knockout matches that are **live or finished** only — upcoming KO fixtures stay hidden:

```js
const koShown = state.matches.filter(m => KO_STAGE_LABELS[m.group_letter])
  .filter(m => m.score_a !== null || isLive(m));
```

- Grouped by stage in fixed order `['R32','R16','QF','SF','3P','F']`, each stage shown only if it
  has a `koShown` match, under the existing `KO_STAGE_LABELS` Portuguese headings
  (`index.html:1249`).
- Cards reuse the current KO card markup (`index.html:1327-1347`): date/time, `team_a` /
  score-box / `team_b`, `AO VIVO` pill when live, `PEN` tag on penalty results. Since upcoming KO
  games are filtered out, the "vs" placeholder branch only ever shows briefly for a just-kicked-off
  live game with no score yet.
- **Cards stay non-clickable.** The match-detail view (`renderMatchDetail`, `index.html:1355`)
  exists to show everyone's *predictions*; KO games have none.
- The `statusFilter` (Todos / Jogados / Por jogar) still composes: under "Por jogar" the
  played-or-live set is empty → the placeholder shows.

### Placeholder

When Fase Final is active but `koShown` is empty (KO rows not seeded yet, or seeded but none
kicked off — the player needn't know which):

> A fase final começa em breve.

This replaces the old "Os quadros serão confirmados em breve pela FIFA." string
(`index.html:1319-1320`), which assumed unseeded brackets.

---

## Seeding dependency

Fase Final stays empty until knockout rows exist **and** the poller scores them. Knockout rows
are added by `seed-knockout.js` and still need `fd_match_id` seeded for the `poll-results`
pipeline to pair and fill scores (per CLAUDE.md: "knockout rows still need seeding when added").
That seeding is operational and owned outside this spec — here we only guarantee that *when*
results arrive, they surface correctly and only once played. No results → placeholder.

---

## Implementation notes

### Files touched

Only `index.html`. No DB, no Edge Function, no scoring change.

### Where the logic lives

- **State**: add `groupFilterTouched: false` to the initial state (`index.html:432`).
- **Effective filter + default**: compute `effectiveFilter` at the top of `renderMatches`
  (`index.html:1251`); use it for both the active-button check and the view branch.
- **Filter row**: append the Fase Final button (gated on `groupStageComplete`) after the
  group-letter buttons (`index.html:1276-1279`); each group button's `onClick` also sets
  `groupFilterTouched: true`.
- **Group-only guard**: the `filtered` computation (`index.html:1258`) for the group views.
- **Fase Final branch**: when `effectiveFilter === "FINAL"`, render `koShown` grouped by stage
  (lifting the markup from the current `index.html:1315-1351` block) instead of the group list;
  otherwise render the group list as today. Delete the old bottom-of-page "Fase Eliminatória"
  block — its job moves into this branch.

### Order of work

1. Add `groupFilterTouched` to state; compute `effectiveFilter`.
2. Group-only guard on `filtered` (fixes the double-render immediately).
3. Add the Fase Final button + `touched` wiring.
4. Branch `renderMatches` on `effectiveFilter`; move KO markup into the FINAL branch; drop the
   old bottom block; swap in the new placeholder.

---

## Out of scope

- **Predicting knockout scorelines** — not a v0 mechanic; bracket/podium predictions live in the
  Bracket tab.
- **Making KO cards clickable / a KO match-detail view** — nothing to show without predictions.
- **Seeding knockout rows or their `fd_match_id`s** — operational, owned elsewhere; this spec
  degrades gracefully (placeholder) until they exist.
- **Podium-elimination computation** — the next spec; it reads the same KO results from a
  scoring angle.
- **v1 (`goalgut/`).**

## Reversibility

Pure render change. The Fase Final button and default only appear post-`groupStageComplete`; the
group-only guard is a no-op during the group stage (no KO rows exist). Reverting is removing the
FINAL branch/button and restoring the two filter expressions.

## Testing

Surface is gated on `groupStageComplete` (≈27 June), so it can't be checked live until then — per
the project's "trust code review when the runtime gate hides the surface" default, review
carefully. To exercise early, in a branch seed a few KO rows (one `live`, one `finished`, one
upcoming) with `groupStageComplete` forced true, and confirm: Fase Final is auto-selected and
shows the finished/live games grouped by stage; the upcoming one is hidden; clicking "Todos" or a
group letter shows group matches only (no KO, no double-render) and sticks; "Por jogar" under
Fase Final shows the placeholder. Don't commit the stub.
