# Spec: Leaderboard chart — unified lines + dinner-cutoff band (v0)

## Problem

Two shortcomings in the leaderboard chart, both surfacing now that the tournament is live and there's exactly **one observer** in the pool:

1. **A chart for a single line.** Per `_archive/observer-members.md`, observers get their own *separate* "Pontos Acumulados" chart (`obs-points-chart`, `index.html:1537`). With one observer that's a whole chart panel rendering a single lonely line — visual dead weight that says nothing a list row doesn't.
2. **The dinner cutoff is invisible over time.** `_archive/leaderboard-v0-dinner-split.md` shades the *ranked list* green/red (who eats, who pays) — but only for the current standing. The chart, which is the one place you can read the race *as it evolved day by day*, shows no cutoff at all. You can't see the paying-half boundary move: who slipped below the line on which day, who clawed back above it.

## Goal

- **One chart, all lines.** Merge the observer's line into the main "Pontos Acumulados" chart alongside the regular players. Drop the separate Observadores chart entirely.
- **Keep the ranking split.** The Observadores section stays a **list only** — separate from Classificação, no dinner shading, no medals — exactly as today minus its chart.
- **Draw the dinner cutoff on the chart, per day.** Shade the "paying" band — the region **including and above the first paying player** (rank `T+1`) — recomputed at each day on the x-axis, so the boundary visibly tracks over time.

**Scope: v0 only.** Themed on the friend-group dinner stake; not ported to the public edition (`goalgut/`). This spec **amends** two shipped specs — see *Amends* below.

---

## Feature 1 — one chart, list-only observers

### Behaviour

- The main chart plots **every player's** cumulative line: non-observers and observers together, same axes, same per-day cumulative computation.
- Observer lines are drawn with a **dashed stroke** (`borderDash: [5,4]`), in addition to the existing `👀` prefix the legend already carries via `playerLabel(p, true)`. The dash is the chart's only dashed line (see Feature 2) — so a dashed line unambiguously means "observer." The single 👀 line is now legible *in context* against the field, which is the whole point of merging.
- The **Observadores ranking section** (`index.html:1532`) renders its header + list rows unchanged, but **without** the `chart-wrap`/canvas block (`index.html:1534-1539`).

This reverses the "two charts, never blended" decision in `_archive/observer-members.md` (lines 99-110) — that call was made for an unknown observer count; with one observer the blend reads better than an orphan chart. The *ranking* pools stay unmixed, which was the substantive integrity concern; only the chart merges.

### Where the logic lives

- `initCharts()` (`index.html:403-406`): build **one** chart over `state.players` (all), keyed `"main"`. Delete the `"observers"` build call. `chartInstances` drops the `observers` key.
- `buildChart()` (`index.html:341`): set `borderDash: [5,4]` on a dataset when `players[i].is_observer`. Colour indexing stays positional over the merged list (`PLAYER_COLORS`, `index.html:339`) — with ≤8 players the palette doesn't wrap.
- Chart gate (`index.html:1512`): show the chart when there is **≥1 player total** and `played.length >= 2` (today it gates on `mainLb.length > 0`). Remove the entire Observadores `chart-wrap` node (`index.html:1534-1539`).

---

## Feature 2 — dinner-cutoff band

### Behaviour

At each day on the x-axis, among **non-observers**, the player at rank `T+1` (`T = Math.floor(N/2)`, golf order, lower cumulative = better) is the *first to pay*. Shade the chart from that player's cumulative value **upward** (toward higher points = worse), in soft red — the live "paying zone." Because it's recomputed per day, the band's lower edge is a stepped fill edge that rises and falls with the race.

- **No boundary line.** The band is a fill only (`rgba(239,68,68,0.10)` up to the top of the y-scale); its lower edge — where red meets the plot — *is* the boundary. Deliberately strokeless so the chart's only dashed line is the observer's (Feature 1). Two dashed lines would compete; one fill + one dash reads cleanly.
- The band is **non-observer-only** even though observer lines now share the chart (Feature 1). An observer line may visually fall inside the red band — that's cosmetically odd but correct: observers aren't in the dinner pool. The caption disambiguates (below).
- Hidden when `N < 2` (no cutoff exists) or `played.length < 2` (no chart).
- Caption under the existing legend line, only when `N >= 2`:
  > 🔴 zona que paga o jantar — abaixo da zona vermelha estás a salvo (observadores 👀 não contam)

### Algorithm

Reuses the per-day cumulative array `buildChart()` already computes per player (`index.html:355-361`). After building the player datasets:

```js
// non-observer cumulative-by-day series only
const compSeries = datasets.filter((_, i) => !players[i].is_observer).map(d => d.data);
const N = compSeries.length;
const T = Math.floor(N / 2);                 // size of the eating half
if (N >= 2) {
  const cutoff = dates.map((_, day) => {
    const vals = compSeries.map(s => s[day]).sort((a, b) => a - b); // golf: ascending
    return vals[T];                          // rank T+1 (0-indexed T) = first payer
  });
  datasets.push({
    label: "__cutoff__",                     // filtered out of the legend
    data: cutoff,
    borderWidth: 0,                          // strokeless — no competing dashed line
    pointRadius: 0,
    fill: "end",                             // fill toward the top of the y-scale
    backgroundColor: "rgba(239,68,68,0.10)",
    order: 99                                // draw behind the player lines
  });
}
```

Exclude it from the legend via `options.plugins.legend.labels.filter: item => item.text !== "__cutoff__"`.

**Complexity:** O(N log N) per day, N ≤ ~8, dates ≤ ~30 — negligible. No new state, no backend, no DB. ~25 lines added to `buildChart()`.

### Edge cases

- **Tie across the cutoff.** If ranks `T` and `T+1` share a cumulative value on a given day, the band simply starts at that shared value — the edge sits exactly on the tied line. The *list* still shows the nuanced neutral-grey tie treatment (`index.html:1405-1410`); the chart band stays coarse by design.
- **Odd N.** `T = floor(N/2)` → the larger (paying) half is shaded, consistent with the list math.
- **A day where the band would cover the whole chart** (everyone clustered) is fine — it's honest.

---

## Amends

- `_archive/observer-members.md` — overrides "Cumulative-points chart: render two charts… the two pools never mix" (lines 99-110). Charts merge; **rankings** still don't.
- `_archive/leaderboard-v0-dinner-split.md` — extends the green/red dinner metaphor from the list onto the chart's time axis. No change to the list shading or the locked-half math.

## Out of scope

- A green "eating zone" band below the line — only the paying band is drawn; safety is read as "below the red zone."
- Per-day locked-half / podium-range projection on the chart — that stays a post-group-stage *list* concern (`leaderboard-v0-dinner-split.md`).
- Re-introducing a separate observer chart if the observer count ever grows — revisit then; v0 has one.
- Any DB, Edge Function, or scoring change. Pure `index.html` render.

## Open questions

- **Observer line inside the red band.** Acceptable with the caption, or should observer lines be dimmed / drawn at lower opacity so the band reads as clearly "regulars only"? Leaning: leave it, caption is enough for one observer.
- **Band legibility on the dark theme.** `rgba(239,68,68,0.10)` over the existing `rgba(255,255,255,0.04)` grid — confirm it's visible but not garish on the live site before finalizing the alpha.
