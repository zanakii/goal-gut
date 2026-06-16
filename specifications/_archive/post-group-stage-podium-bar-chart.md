# Spec: Post-group-stage podium bar chart (v0 only)

## Problem

The leaderboard's "Pontos Acumulados" line chart (`buildChart`, `index.html:341`) is built
purely from match-prediction points over scored matches, bucketed by day (`index.html:347-360`).
It works beautifully during the group stage — 72 matches across ~16 days draw a dense, lively
race. But the moment the group stage ends it dies:

1. **It flatlines.** The x-axis is calendar dates of *scored matches*. With no group matches
   left and no knockout score-predictions in v0 (players predict the bracket/podium, not
   knockout scorelines), no new dates ever appear. The line just stops — and worse, once
   knockout rows start getting scored it sprouts a meaningless flat trailing tail.
2. **It can't show the only thing still moving.** After the group stage, the sole source of
   leaderboard movement is podium points — each player's 1-2-3 pick, scored as their predicted
   teams get eliminated or land on the real podium. The line chart never reads `calcPodiumPts`
   at all, so the most dramatic swings of the whole tournament (a +20 penalty when your champion
   pick crashes out in the quarters) are completely invisible on it.

So for the back half of the tournament — the knockouts, the most-watched part — the chart shows
a frozen group-stage snapshot while the actual race plays out only in the list rows. The people
who feel this are the whole pool, every match day from the Round of 32 to the final.

## Goal

- **Once the group stage completes, lead with a bar chart** that makes podium movement the
  headline: one bar per player, growing taller as their podium picks resolve.
- **Keep the line chart, demoted and frozen.** Move the existing "Pontos Acumulados" line chart
  to the **bottom** of the leaderboard section as the group-stage record, and cap it at the group
  stage so it never grows a stale knockout tail. Observers stay on it as dashed lines.
- **Score from the single source of truth.** Bar segments read `calcPodiumSlotPts`
  (0 / 10 / 20) — never a re-derived scale. (See *Scoring divergence to avoid* below.)

**Scope: v0 only.** This spec covers **only the chart swap**. What knockout rows show in the
Matches tab, and how podium-pick elimination is computed, are separate follow-up specs.

---

## When it switches

Trigger is `tournamentState.groupStageComplete` (`computeActualTournamentState`,
`index.html:720-726`) — the same flag that already gates `calcPodiumPts` and the
locked-half/position-range list treatment (`_archive/leaderboard-v0-dinner-split.md`).

| State | Top of leaderboard section | Bottom of leaderboard section |
|-------|----------------------------|-------------------------------|
| Group stage in progress | Line chart "Pontos Acumulados" (today) | — |
| Group stage complete | **Bar chart "Pontos: grupos + pódio"** | Line chart "Pontos Acumulados" (relocated, frozen) |

Nothing changes before the group stage ends. Right now the DB has 72 group rows, 16 scored —
this surface stays dormant until the last group match goes final (≈27 June). See *Testing*.

---

## The bar chart

### What a bar is

One bar per player. **Order: non-observers first, left→right by current leaderboard rank** (leader
leftmost, matching the list directly above), **then observers appended on the right**, shown but
visibly set apart (`👀` prefix, lower-opacity fills). Each bar is a **stack**:

```
  pontos (penalização — mais alto = pior)
   ▲
   │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ← zona que paga (rank T+1 p/ cima)
   │  ▓         ┌────┐    ┌────┐    ▓
   │  ▓┌────┐   ├────┤    ├────┤ 🇭🇷 ▓ 🥉 +20
   │   │    │   ├────┤ 🇫🇷 ├────┤    │ 🥈 +10
   │   │base│   │base│    │base│    │ ← grupos
   │   └────┘   └────┘    └────┘    │
  ─┼── (eixo começa em mín−10, não em 0) ──►
   │   Pedro    Ana      Miguel   👀Rita
```

- **Base segment** = the player's group-stage match points (`Σ calcPts` over scored matches —
  identical to today's `total` minus podium). One muted fill, same for every bar.
- **Up to three podium segments** stacked on the base, one per 🥇🥈🥉 slot, each appearing only
  when that pick **resolves**:
  - **+20** when the predicted team is eliminated (or finishes off the podium) — the big leap.
  - **+10** when the team makes the real podium but in the wrong slot ("lugar errado").
  - **+0** when exact — contributes no height, so no visible segment (correct: a perfect pick
    costs nothing in golf scoring).
- An **unresolved** pick (team still alive, final position unknown) contributes nothing yet —
  `calcPodiumSlotPts` returns `null`. The segment materialises the moment it resolves, which is
  exactly the "lively, leaps as teams go out" behaviour we want.

Total bar height = base + resolved podium points = the player's leaderboard `total`. The chart
and the list never disagree, by construction.

### Why taller = worse (golf scoring, not inverted)

The whole app is golf-scored: lower is better, the list sorts ascending, the leader shows the
smallest number. The bar chart keeps that — **the shortest bar leads**, and bars *grow* as
podium picks die. Inverting to "taller = winning" would force a second, contradictory mental
model onto the one number players already read everywhere else. Instead we lean into it: the
narrative is "watch the damage pile up," and the caption states it outright.

### Y-axis floor — start at `min − 10`, not 0

The y-axis starts at `Math.max(0, minTotal − 10)`, where `minTotal` is the lowest bar total
across all shown players (observers included). Anchoring at 0 wastes the bottom of the plot on a
band every bar shares, flattening the differences that matter; floored just below the leader,
the gaps between players — and the size of each +10/+20 leap — read clearly. Stacked bars still
compute from 0 internally; Chart.js simply clips below `y.min`, so the bars "float" from the
axis floor. Clamped at 0 because golf totals are never negative.

### Dinner-cutoff red band

Carry the line chart's paying-zone shading (`_archive/leaderboard-chart-unified-and-cutoff-band.md`)
onto the bar chart as a horizontal band. Among **non-observers**, sorted ascending by `total`,
the player at rank `T+1` (`T = Math.floor(N/2)`, `N` = non-observer count) is the first to pay.
Shade from that player's total **upward** to the top of the plot in soft red — every bar whose
total reaches into the band is in the paying half right now.

- It's a **single static threshold** at the current standing — unlike the line chart's per-day
  stepped edge, a bar chart has no time axis, so there's one cutoff line, recomputed each render
  as podium points resolve.
- **Non-observer-only**, like the line chart: an observer bar may poke into the red — cosmetically
  odd but correct (observers aren't in the dinner pool), disambiguated by the caption.
- Drawn by a ~15-line inline Chart.js plugin (`beforeDatasetsDraw`) filling a rect from
  `y.getPixelForValue(cutoff)` to the top of the plot area — no annotation-plugin dependency.

### Segment colour & label

Colour encodes the **outcome**, not the player (the x-axis already says who):

| Outcome | `calcPodiumSlotPts` | Fill |
|---------|--------------------:|------|
| Exacto | 0 | — (no segment) |
| Lugar errado | 10 | amber `rgba(251,191,36,0.55)` |
| Eliminado / fora do pódio | 20 | red `rgba(239,68,68,0.55)` |
| Base (fase de grupos) | — | `rgba(255,255,255,0.18)` |

Each podium segment is labelled with the **picked team's flag** (`flagOf(team)`) via
`chartjs-plugin-datalabels` (one CDN `<script>`, same pattern as `index.html:8`). A `display`
callback shows the flag only in segments tall enough to hold it (≈16px), so thin segments stay
clean; the full detail always lives in the tooltip:

> 🥇 Brasil — eliminado (+20)

### Modelling it in Chart.js

Four stacked datasets over the player categories, not one-dataset-per-player:

```js
// `players` = non-observers rank-sorted, then observers; one entry per player
const base     = players.map(p => p.groupTotal);
const slotData = mi => players.map(p => {
  const pts = calcPodiumSlotPts(mi, p.podiumArr[mi], tournamentState); // 0 | 10 | 20 | null
  return pts == null ? 0 : pts;                 // unresolved → no height yet
});
const slotFill = mi => players.map(p => {
  const pts = calcPodiumSlotPts(mi, p.podiumArr[mi], tournamentState);
  const a = p.is_observer ? 0.28 : 0.55;        // observers dimmed
  return pts === 20 ? `rgba(239,68,68,${a})` : pts === 10 ? `rgba(251,191,36,${a})` : "transparent";
});

datasets = [
  { label: "Fase de grupos", data: base, backgroundColor: players.map(p => p.is_observer ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.18)"), stack: "s" },
  { label: "🥇", data: slotData(0), backgroundColor: slotFill(0), stack: "s" },
  { label: "🥈", data: slotData(1), backgroundColor: slotFill(1), stack: "s" },
  { label: "🥉", data: slotData(2), backgroundColor: slotFill(2), stack: "s" },
];
// scales: { x: { stacked: true }, y: { stacked: true, min: Math.max(0, minTotal - 10), title: "Pontos" } }
```

Per-data-point `backgroundColor` arrays are how each player's same-slot segment gets coloured by
*their* outcome. Tooltip callback reads `p.podiumArr[mi]` + the outcome to compose the team line.
Datalabels `formatter` returns `flagOf(p.podiumArr[mi])`; `display` gates on segment height.

---

## Freezing the line chart

The relocated line chart must show the **complete group-stage race and stop** — no flat tail once
knockout rows get scored. Restrict its source to group matches:

```js
// buildChart, replacing `state.matches.filter(m => m.score_a !== null)` at index.html:347
const played = state.matches
  .filter(m => m.score_a !== null && m.group_letter && m.group_letter.length === 1)
  .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
```

Group matches are the only ones with score-predictions, so this changes nothing during the group
stage (knockout rows don't exist yet) and cleanly caps the x-axis afterward. The line chart
becomes a permanent group-stage record; the bar chart owns the knockout story.

---

## Scoring divergence to avoid

The expanded leaderboard row currently **re-derives** podium points inline on a wrong scale
(`index.html:1506`): eliminated→10, lugar-errado→5, exacto→0 — half of what the authoritative
`calcPodiumSlotPts` (`index.html:220-232`) charges (20 / 10 / 0), which is what actually feeds
`total`. The expanded breakdown has been under-reporting podium points the whole time.

This spec does **not** fix `:1506` — that belongs to the podium-calc follow-up — but it must not
repeat the mistake: the bar chart calls `calcPodiumSlotPts` directly, never a local copy. CLAUDE.md's
"scoring lives in `calcPts`/`calcPodiumPts`/`calcPodiumSlotPts` — single source of truth, do not
duplicate" applies. Flagging here so the two specs stay consistent.

---

## Implementation notes

### Files touched

Only `index.html`, plus one new CDN `<script>` for `chartjs-plugin-datalabels`. No DB, no Edge
Function, no scoring-logic change (`calcPodiumSlotPts` already returns 0/10/20/null).

### Where the logic lives

- **New builder** `buildPodiumBarChart(canvasId, players, instanceKey)` next to `buildChart`
  (`index.html:341`). `buildChart` stays line-only; the bar logic is different enough
  (categories, stacking, per-point colours, cutoff plugin) that a sibling reads cleaner than a
  mode flag.
- **Cutoff-band plugin**: a small inline plugin object passed to the bar chart's `plugins`
  array; computes `T`/`cutoff` from the non-observer totals and fills the rect.
- **`chartInstances`** (`index.html:337`): add a `bar` key alongside `main`. Destroy/recreate
  guard mirrors `index.html:344`.
- **`initCharts`** (`index.html:425-427`): when `groupStageComplete`, build `bar` (top canvas)
  **and** `main` (relocated line canvas); otherwise build `main` only.
- **`buildChart` freeze**: the group-only `played` filter above.
- **Render** `renderLeaderboard` (`index.html:1532-1543`): pre-group, the line `chart-wrap`
  stays at the top. Post-group, render the **bar** `chart-wrap` + "Comem / Pagam" caption in that
  top slot, and move the **line** `chart-wrap` to the very end of the section, after the observer
  list. Separate canvas ids (`podium-bar-chart`, `points-chart`).
- **Player rows feed the chart**: `renderLeaderboard` already computes `groupTotal`
  (`index.html:1437`), `podiumArr`, and rank order — pass the rank-sorted `lb` (non-observers
  then observers) straight in.
- The post-render `setTimeout(() => initCharts(), 0)` (`index.html:2026`) already fires after
  every render; no scheduling change.

### Caption (PT)

Under the bar-chart header, shown post-group only:

> 🔴 zona que paga o jantar · barra mais curta lidera · cada eliminação do pódio soma 20 (observadores 👀 não contam)

### Order of work

1. `buildPodiumBarChart` against the canonical scorer; tooltip composes team + outcome.
2. Cutoff-band inline plugin + `min: max(0, minTotal − 10)` y-axis.
3. Add datalabels CDN; flag formatter + height-gated `display`.
4. Wire `initCharts` + `chartInstances.bar` behind `groupStageComplete`.
5. Relocate the line `chart-wrap` to the section bottom; freeze its source to group matches.
6. Add the bar `chart-wrap` + caption to the top slot.

---

## Out of scope

- **Matches-tab knockout display** and **podium-elimination computation** — the two follow-up
  specs. This one assumes `calcPodiumSlotPts` / `tournamentState.eliminated` are correct as-is.
- **Fixing the `:1506` 0/5/10 divergence** — flagged above, fixed in the podium-calc spec.
- **The line chart's internals** — relocated and frozen to group matches; the cutoff band and
  dashed observer lines carry over verbatim (`_archive/leaderboard-chart-unified-and-cutoff-band.md`).
- **Knockout score-prediction** — v0 players don't predict knockout scorelines; the base
  segment is group points only and stays that way.
- **v1 (`goalgut/`).** The bar-vs-line, golf-inverted framing is a v0 call; revisit for the
  public edition's audience.

## Reversibility

Fully gated on `groupStageComplete`. Until the last group match is final, this code path never
executes — shipping it now changes nothing live. If the bar chart underwhelms once the knockouts
start, reverting is deleting the post-group branch and leaving the line chart in the top slot
(drop the group-only freeze filter to restore its old behaviour).

## Testing

The surface is hidden until `groupStageComplete` (≈27 June), so it **can't be visually verified
on the live site before then** — per the project's "trust code review when the runtime gate
hides the surface" default, review carefully rather than shimming production. To exercise it
early, force the flag locally (e.g. temporarily seed all 72 group rows `finished` in a branch,
or stub `computeActualTournamentState` to return `groupStageComplete: true` with a few
`eliminated` teams) and confirm segment heights/colours against hand-computed `calcPodiumSlotPts`
values, plus the cutoff band and `min−10` floor. Do not commit the stub. Tune the band alpha and
floor offset on the dark theme before finalising.
