# Spec: One rank authority — canonical tie-break ladder (v0 only)

Amends `_archive/tie-break-ladder-reorder.md` (reverses its 3-way champion bucket) and `_archive/exact-possible-rank-range.md` (extends its "one comparator" goal to the surfaces it missed).

## Problem

The pool has **three comparators over the same players**, and they disagree on one axis. PR #58 unified the *possible-rank range* with the board (both now use `compareStandings`/`sameRank`), and its body claimed "range, displayed rank, and Contas conditions now share one comparator, so they can't disagree." That was only half-true. Two surfaces were left on the old key:

- **Contas** (`contasCmp`, consumed by `enumeratePodiumClasses` for *first*/*pays*) still ranks on the graded `champKey` (`right < alive < 10 < 20`), while the board's rank authority `sameRank` uses the coarser `champBucket` (`right/alive/wrong`). So two players level on `total` and `gamePts` whose champion picks died differently (lost-final `10` vs out-early `20`) are **tied on the board** but **ordered by Contas** — Contas can tell a player *"só pagas se…"* while the leaderboard beside it ties them and neutralises the dinner line.
- **The chart dinner bands** (`buildChart`, `buildPodiumBarChart`) shade upward from a raw median total (`vals[Math.floor(N/2)]`), skipping the cutoff-tie neutralisation `classifyBoard` applies — so the red band can mark a player as paying whom the board holds neutral.

It's latent today (tournament over, all 11 totals distinct) but it was live and user-facing throughout the knockouts, and it will recur every edition until the comparators are collapsed to one.

Underneath the mechanics is a **governance point**: only tie-breakers the players actually agreed to may decide a *position* (rank, medal, who pays dinner). Two were agreed — **correct champion pick** and **group-stage points**. Everything else (`tie-break-ladder-reorder.md` had a live champion out-ranking a dead one; exacts; alphabetical) is a *display* nicety that was never voted, so it must not move anyone up or down a position.

## Goal

- **One rank authority.** `sameRank` — and *only* `sameRank` — sets position, medal, and dinner side, on the two approved keys.
- **Everything else is display order.** A single explicit ladder decides who prints above whom *inside* a shared rank, and can never change the rank.
- **Make the divergent surfaces borrow that authority.** `contasCmp` and the bar-chart band adopt the `sameRank` definition, so board rank, possible-rank range, Contas conditions, and chart bands agree by construction — this time actually, not aspirationally.
- No DB, no scoring change. `calcPts`/`calcPodiumSlotPts`/`calcPodiumPts` are untouched; the comparators *read* the canonical scores, they don't redefine them.

**Scope: v0 only.**

---

## The canonical ladder

Each key is consulted only when everything above it is equal. The **rank line** is the hard boundary: keys above it decide position; keys below it are display-only and provably cannot change a rank.

| # | Key | Direction | Sets rank? |
|---|-----|-----------|:---:|
| 1 | **Total** (golf, includes podium) | lower wins | ✅ |
| 2 | **Correct champion pick** — got the actual champion, **yes vs no** (alive and dead are both "no") | right first | ✅ |
| 3 | **Group-stage points** (`gamePts`, group games only) | lower wins | ✅ |
| — | *— rank determined above this line —* | | |
| 4 | **Champion still alive beats already dead** — within "no": `alive < lost-final(10) < out-early(20)` | lower wins | display |
| 5 | **Less remaining podium exposure** — worst-case podium points still gettable; a fully-locked player prints above a tied one who can still worsen | lower wins | display |
| 6 | **Exacts** | more wins | display |
| 7 | **Alphabetical** (`localeCompare`, `"pt"`) | A→Z | display (stable) |

### The one behavioural change — key 2 goes 2-way

`tie-break-ladder-reorder.md` deliberately made the rank champion bucket **3-way** (`right/alive/wrong`), so mid-tournament a *live* champion pick out-ranked a *dead* one. This spec **reverses that**: for rank, key 2 is **2-way** — you called the champion or you didn't; alive and dead collapse together. The alive-vs-dead distinction drops to display-only (key 4).

Consequence, stated plainly because it changes who pays dinner: **mid-tournament, two players tied on `total` and `gamePts` now share a rank and a dinner side regardless of whether their champion pick is alive or already eliminated.** Before the final decides a champion, key 2 separates nobody (no one is "right" yet), so it is naturally inert until the cup is lifted — exactly as the graded key was, minus the unapproved alive-above-dead split.

*Why this direction, not the other?* The divergence could be closed by making the board *finer* (match Contas) instead of Contas *coarser* (match the board). We coarsen, because #58 already committed the board to `champBucket`, and — the governing reason — the players only sanctioned two rank criteria. Fewer distinctions breaking a position, not more.

### Key 5 detail — remaining podium exposure

Display-only, and moot once every pick resolves (0 for everyone at tournament end; 60 for everyone during the group stage, so inert there too). Defined as worst-case additional podium points still reachable:

```js
// worst case = every still-unresolved slot ends off-podium (+20). fewer open slots ⇒ safer ⇒ prints higher.
function podiumExposure(p, ts) {
  return [0, 1, 2].reduce((n, i) =>
    n + (calcPodiumSlotPts(i, p.podiumArr?.[i], ts) === null ? 20 : 0), 0);
}
```

A player already at their podium ceiling ("can't get anymore") sorts above a tied player who "can still score points." The `20 × open-slots` worst-case is a deliberate simplification — it ignores that bracket geometry may already cap an open slot at `10` — accepted because key 5 never touches rank (see `_archive/structural-podium-floor.md` for the geometry it declines to re-derive).

### The comparators

```js
// RANK criterion 2 — champion called or not. right(0) vs not(1); alive & dead both "not".
function correctChamp(p, ts) {
  return calcPodiumSlotPts(0, p.podiumArr?.[0], ts) === 0 ? 0 : 1;
}
// DISPLAY key 4 — among "not", alive prints above lost-final above out-early. (right never reaches here.)
function champDeadness(p, ts) {
  const slot = calcPodiumSlotPts(0, p.podiumArr?.[0], ts); // 0 | null | 10 | 20
  return slot === null ? 0 : slot === 10 ? 1 : slot === 20 ? 2 : 0;
}

function compareStandings(a, b, ts) {
  return a.total - b.total                                   // 1  golf total            [RANK]
      || correctChamp(a, ts) - correctChamp(b, ts)           // 2  champion right vs not  [RANK]
      || (a.gamePts ?? a.total) - (b.gamePts ?? b.total)     // 3  group-stage points     [RANK]
      || champDeadness(a, ts) - champDeadness(b, ts)         // 4  alive < lost-final < out
      || podiumExposure(a, ts) - podiumExposure(b, ts)       // 5  less remaining exposure
      || b.exacts - a.exacts                                 // 6  more exacts
      || (a.name ?? "").localeCompare(b.name ?? "", "pt");   // 7  alphabetical, stable
}

function sameRank(a, b, ts) {
  return a.total === b.total
      && correctChamp(a, ts) === correctChamp(b, ts)         // 2-way: right vs not
      && (a.gamePts ?? a.total) === (b.gamePts ?? b.total);
}
```

`champKey` and `champBucket` are **retired** — `correctChamp` + `champDeadness` replace them, and no other caller reads them (verified: `champKey` only in `compareStandings`/`contasCmp`, `champBucket` only in `sameRank`).

### Unification — the two surfaces that borrow the authority

**Contas** (`contasCmp`) becomes the strict prefix of `sameRank`:

```js
function contasCmp(a, b, ts) {
  return (a.total - b.total)
      || (correctChamp(a, ts) - correctChamp(b, ts))
      || ((a.gamePts ?? a.total) - (b.gamePts ?? b.total));
}
```

This closes the Contas divergence (and its in-function twin: *first*/*pays* used `contasCmp` while `rankRange` used `compareStandings`/`sameRank`) for free. *first*/*pays* count players "strictly ahead" (`contasCmp(q,p) < 0`); with `contasCmp` now agreeing with `sameRank`, two equal-rank players are never ahead of each other, so they always land on the same side of the `pays` threshold — which is exactly what `classifyBoard`'s cutoff-tie neutralisation produces. No explicit neutralisation needed in Contas; aligning the comparator *is* the fix. (A straddling `sameRank` block has `ahead = players strictly above it < T`, so the whole block doesn't pay — matching the board.)

**Bar chart band** (`buildPodiumBarChart`) stops inventing its own cutoff and reads the board's paying set:

```js
const { main } = classifyBoard(players, ts);                 // already the rank/dinner authority
const payers = main.filter(p => p.dinnerHalf === "bottom");
const cutoff = payers.length ? Math.min(...payers.map(p => p.total)) : null;
// shade y >= cutoff  (neutralised players are not "bottom", so the band starts above them)
```

## Data model / Backend

None. Pure `index.html` render/ordering logic.

## Implementation notes

### Files touched
- `index.html` only.

### Where the logic lives
- **`champKey` / `champBucket`** (defined near the scoring block): remove; add `correctChamp`, `champDeadness`, `podiumExposure`.
- **`compareStandings` / `sameRank`**: replace bodies per above.
- **The ladder header comment** (the block above `champKey`): rewrite — it's the in-code single source of truth and must not drift from this table.
- **`contasCmp`**: swap `champKey` → `correctChamp`.
- **`enumeratePodiumClasses`**: `sRows` must carry `name` so the alphabetical key doesn't `localeCompare` `undefined` (rank output is unaffected — alphabetical only orders *within* a shared rank — but it must not throw).
- **`buildPodiumBarChart`**: replace the median-total cutoff with the `classifyBoard`-derived paying set.
- **`classifyBoard`**: the explicit cutoff-tie neutralisation block becomes redundant belt-and-braces once `sameRank` is the sole authority, but leave it — it's cheap and self-documenting.

### Order of work
1. Add `correctChamp` / `champDeadness` / `podiumExposure`; delete `champKey` / `champBucket`.
2. Rewrite `compareStandings`, `sameRank`, and the ladder header comment.
3. Align `contasCmp`; add `name` to `enumeratePodiumClasses` rows.
4. Re-point the bar-chart cutoff through `classifyBoard`.

---

## Out of scope

- **Changing `calcPts` / `calcPodiumSlotPts` / `calcPodiumPts`** — this is ordering only.
- **The line chart's daily band** (`buildChart`). It plots cumulative *group* points, not `total`; during the group stage rank collapses to `total == gamePts` with key 2 inert, so its median band is already correct, and post-group-stage it's a frozen group-points history, not the dinner authority (the bar chart is). Untouched, by design.
- **Head-to-head / runner-up / third tie-breaks** — anything level after key 7 is a genuine tie sharing a rank.
- **v1 (`goalgut/`).**

## Reversibility

Pure render change, no persisted state. Revert by restoring `champKey`/`champBucket` and the previous comparator bodies. Behaviourally inert until the knockouts (keys 2/4/5 dormant during the group stage), so shipping now changes nothing live until the next edition's bracket.

## Testing

- **Key 2 goes 2-way** is the one new rank behaviour. Construct (in a throwaway branch, `groupStageComplete` forced) two players equal on `total` and `gamePts` with champion slots `10` and `20`: they must **share** rank + medal + dinner side, while the `10` player still **prints** above the `20` (key 4). Don't commit the stub.
- **Contas ↔ board agreement**: at a mid-knockout state with a genuine `total` tie across the dinner cutoff, confirm the *"pagas"* sentence matches `classifyBoard`'s `dinnerHalf` for every player, and that the bar-chart band shades exactly the paying set.
- **No live regression**: today's board is unaffected (11 distinct totals); the change bites only when a tie forms.
- Per the project's "trust code review when the runtime gate hides the surface" default, review the comparators rather than waiting for a live tie.
