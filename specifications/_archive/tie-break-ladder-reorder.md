# Spec: Tie-break ladder reorder — champion first, true ties on the four real criteria (v0 only)

## Problem

The current tie-break ladder (`compareStandings` / `sameRank`, `index.html:285-300`) was built to add depth, but it ordered the criteria by *what we could resolve early* rather than by *what actually decides the pool*:

```js
function compareStandings(a, b, ts) {
  return a.total - b.total
      || b.exacts - a.exacts                              // ← exacts treated as the top tie-break
      || (a.gamePts ?? a.total) - (b.gamePts ?? b.total)
      || champKey(a, ts) - champKey(b, ts);              // ← champion buried last
}
```

Two problems with this, now that the rules are settled:

- **Champion is the headline criterion, not the footnote.** The pool's real hierarchy is: who guessed the World Champion, then group-stage points, then exact results. Exacts being first is backwards — it leads the *visible* order only because it's the one criterion resolvable throughout the group stage, not because it outranks the champion call.
- **`sameRank` over-splits genuine ties.** It compares the champion slot on the *graded* `champKey` (`0 < null < 10 < 20`), so two players who both got the champion **wrong** — one eliminated in the Round of 32 (`20`), one who lost the final (`10`) — are forced into different ranks even when total, group points, and exacts are all identical. Per the rules they're tied: both simply got the champion wrong. The graded distinction is a *display* nicety, not a rank-defining rule.

## Goal

- **Reorder the real ladder** to: total → champion → group-stage points → exacts.
- **Define a true tie** (shared rank + shared medal) as equality on those four, with the champion compared as a **three-state bucket** — both-right / both-still-alive / both-wrong — so the 10-vs-20 gradation no longer breaks a rank.
- **Keep the finer gradations as visual-only sorting** — they decide who is *printed* above whom *inside* a shared rank, never the rank number itself.
- No DB, no scoring change. Same two functions, same single source of truth.

**Scope: v0 only.** Amends `_archive/leaderboard-tie-breaks.md`.

---

## The revised ladder

Each criterion is consulted only when everything above it is equal.

| # | Criterion | Direction | When it bites |
|---|-----------|-----------|---------------|
| 1 | **Total** (golf score, includes podium points) | lower wins | always |
| 2 | **Champion-pick outcome** (1st-place podium slot) | `0 < null < 10 < 20` | dormant until the knockouts |
| 3 | **Group-stage game points** (group games only, excludes podium) | lower wins | dormant until the group stage ends |
| 4 | **Exact scores** | more wins | always |

### Why this order — and why it still behaves sensibly mid-tournament

The champion call is the pool's deepest distinction, so it sits directly under total. It looks like it "should only matter after the final," but it **self-activates correctly without any phase gate**, because `calcPodiumSlotPts(0, …)` returns:

- `null` for *every* player during the group stage (`groupStageComplete` is false) → criterion 2 is inert → the ladder collapses to **total → group points → exacts**, and since `gamePts === total` while podium is null, that's effectively **total → exacts**: exactly the "exacts decides while the champion is unknown" behaviour you want.
- `null` for a still-alive champion pick, `20` for an eliminated one, once the knockouts start → criterion 2 begins biting the moment a champion pick crashes out, ranking a **live champion above a dead one** even before the final. Right champion (`0`) only becomes possible once the cup is lifted.

So champion-first needs no `champion != null` guard — the dormancy is already encoded in the scorer.

### Criterion 2 detail — graded for ordering, bucketed for ties

`champKey` stays the 4-way ordering it is today (`index.html:285`), used by `compareStandings`:

| Champion slot | Meaning | `champKey` |
|---|---|---|
| `0` | predicted champion won the cup | `0` (best) |
| `null` | predicted champion still alive | `1` |
| `10` | reached the podium, isn't champion (e.g. lost the final) | `2` |
| `20` | eliminated / never on the podium | `3` (worst) |

For **true-tie** purposes, `10` and `20` collapse — both mean "got the champion wrong":

```js
// graded — drives display order (existing)
function champKey(p, ts) {
  const slot = calcPodiumSlotPts(0, p.podiumArr?.[0], ts); // 0 | 10 | 20 | null
  return slot === 0 ? 0 : slot === null ? 1 : slot === 10 ? 2 : 3;
}
// bucketed — drives rank equality (new): right / alive / wrong
function champBucket(p, ts) {
  const slot = calcPodiumSlotPts(0, p.podiumArr?.[0], ts);
  return slot === 0 ? "right" : slot === null ? "alive" : "wrong"; // 10 & 20 → "wrong"
}
```

### The revised comparators

```js
function compareStandings(a, b, ts) {
  return a.total - b.total                               // 1. golf total, lower wins
      || champKey(a, ts) - champKey(b, ts)              // 2. champion (graded, lost-final beats out-early)
      || (a.gamePts ?? a.total) - (b.gamePts ?? b.total) // 3. fewer group-stage game points
      || b.exacts - a.exacts;                            // 4. more exact scorelines
}

function sameRank(a, b, ts) {
  return a.total === b.total
      && champBucket(a, ts) === champBucket(b, ts)       // right / alive / wrong only
      && (a.gamePts ?? a.total) === (b.gamePts ?? b.total)
      && a.exacts === b.exacts;
}
```

Note the asymmetry by design: `compareStandings` uses the **graded** `champKey` (so a lost-the-final pick is *printed* above an out-in-the-R32 pick), while `sameRank` uses the **bucketed** `champBucket` (so those two **share a rank number and medal**). That gap is the whole "visual-only sorting within a shared rank" behaviour, made concrete.

### Still no "fewer podium points" criterion

The original spec's reasoning holds and is worth restating after the reorder: `total = gamePts + podiumPts`, so two players equal on **total** and **group points** are necessarily equal on total podium points. The meaningful podium signal is the *champion* slot specifically, which criterion 2 captures directly — a separate "podium points" criterion would be arithmetically dead.

---

## True ties — shared rank, shared medal

Unchanged mechanically from the original spec — only the equality test (`sameRank`) changed. A true tie shares a rank *and* a medal, competition style; the repeated rank number is the tie signal. The new effect is simply **more** honest ties: two players who both whiffed the champion now tie if level on total, group points, and exacts, regardless of *how* their champion pick died.

```
🥇  1   ANDRÉ        15   ·  3 exatos      (champion lost the final — 10)
🥇  1   GONÇALO      15   ·  3 exatos      (champion out in the R32 — 20)
🥉  3   PEDRO        18   ·  2 exatos
```

Rank assignment after sorting is the existing competition-ranking pass (ties share, next rank skips); it just consumes the revised `sameRank`.

---

## Data model / Backend

None. Pure `index.html` render logic. No change to `calcPts` / `calcPodiumPts` / `calcPodiumSlotPts` — the comparators *read* the canonical champion-slot score, they don't redefine it.

## Implementation notes

### Files touched
- `index.html` only.

### Where the logic lives
- **`compareStandings`** (`index.html:289`): reorder to total → `champKey` → `gamePts` → `exacts`.
- **`sameRank`** (`index.html:296`): swap graded `champKey` for the new `champBucket`, and align the criteria with the reordered ladder.
- **`champBucket`** (new): add next to `champKey` (`index.html:285`). Collapses `10`/`20` → `"wrong"`.
- **Header comment** (`index.html:274-284`): rewrite the ladder description to match the new order and the graded-vs-bucketed split. This comment is the in-code single source of truth and must not drift from the spec.
- **Consistency**: both comparators already take `ts` and are reused by the game-day position-delta board (`boardAsOf`); no extra wiring — the reuse keeps the board and arrows on one ordering, as before.

### Order of work
1. Add `champBucket` beside `champKey`.
2. Reorder `compareStandings`.
3. Update `sameRank` (bucketed champion + reordered criteria).
4. Rewrite the ladder header comment.

---

## Out of scope
- **Dinner-split / locked-half classification** (`index.html:1770-1803`) — computed from `minTotal`/`maxTotal`, not from `champKey`, so it's untouched. Its cutoff-tie neutralisation stays as-is.
- **Tie-breaking the runner-up or third podium slots** — criterion 2 is champion-only by design; anything still level after exacts is a genuine tie and shares a rank.
- **Showing *why* a tie broke** (e.g. "ahead on champion pick") in the expanded row.
- **v1 (`goalgut/`).**

## Reversibility

Pure render change, no persisted state. Revert by restoring the previous criterion order in `compareStandings` and the graded `champKey` in `sameRank`. Behaviourally inert until the group stage ends (criterion 2/3 dormant), so shipping now changes nothing live until the knockouts.

## Testing

- **The bucket-collapse tie** is the one new visible behaviour and only diverges once champion picks start getting eliminated (late June into July). Per the project's "trust code review when the runtime gate hides the surface" default, review the comparators rather than waiting.
- To exercise early, in a branch force `groupStageComplete` and seed an `eliminated` set giving two players the same total/gamePts/exacts with champion slots `10` and `20`; confirm they **share** rank+medal (bucketed) yet the `10` player renders above the `20` (graded). Don't commit the stub.
