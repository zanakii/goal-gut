# Spec: Leaderboard tie-breaks + true-tie display (v0 only)

## Problem

The leaderboard sort is two criteria deep (`index.html:1641`):

```js
.sort((a, b) => a.total - b.total || b.exacts - a.exacts)
```

Lower total wins; ties broken by more exact scores; **after that, nothing** — order falls to
whatever the input array happened to be. Two consequences, both seen live this week:

- When 1st and 2nd matched on *both* total and exact scores, they still rendered as a clean
  1º/2º with distinct 🥇/🥈 medals. To the viewer they look definitively ordered, but the
  separation is meaningless — it's array order, not a rule.
- There is **no third tie-break**, so genuinely-equal players are silently ranked against each
  other with no principle behind it.

The dinner-split code already *detects* ties and neutralises them (`index.html:1652`), so the data
is there — but the ranked display the players actually read ignores it.

## Goal

- **Add a deeper tie-break ladder** — four criteria, the last two dormant until late in the
  tournament but principled when they bite.
- **Surface true ties honestly.** Players who are genuinely indistinguishable (equal on *every*
  criterion) share a rank **and** a medal, golf/competition style — not a fake clean ordering.
- Keep the change inside the sort + the row renderer. No DB, no scoring change.

**Scope: v0 only.**

---

## The tie-break ladder

Each criterion is consulted only when everything above it is equal.

| # | Criterion | Direction | When it bites |
|---|-----------|-----------|---------------|
| 1 | **Total** (golf score, includes podium points) | lower wins | always |
| 2 | **Exact scores** | more wins | always |
| 3 | **Group-stage game points** (group games only, excludes podium) | lower wins | dormant until the group stage ends |
| 4 | **Champion-pick outcome** (1st-place podium slot) | `0 < null < 10 < 20` | dormant until the knockouts |

### Criterion 3 — group-stage game points

Each player's points from the 72 group games only, excluding podium. It's exactly `total`
*before* the podium contribution is added (`index.html:1638`), so it's a free byproduct:

```js
let total = 0, scored = 0, exacts = 0;
played.forEach(m => { /* … accumulate game points … */ });
const gamePts = total;                       // ← frozen game-only score
const podiumPts = calcPodiumPts(podiumArr, tournamentState);
if (podiumPts !== null) total += podiumPts;  // total = gamePts + podiumPts
```

Fewer wins (golf). Knockout scorelines aren't predicted in v0, so `gamePts` stops changing once
the group stage is over — a stable "who predicted the actual games better" tiebreaker among
players who finished level.

### Criterion 4 — champion-pick outcome

A binary alive/eliminated flag would be wrong: a champion pick that **loses the final** reaches
the podium (scores 10 in the champion slot), and must rank above a pick **eliminated early**
(20). The scoring already encodes the full gradation in `calcPodiumSlotPts(0, …)` — `0 | 10 | 20
| null` — so criterion 4 is a 4-way ordering of the champion slot:

| Champion slot | Meaning | Sort key |
|---|---|---|
| `0` | predicted champion won the cup | `0` (best) |
| `null` | predicted champion still alive | `1` |
| `10` | reached the podium but isn't champion (e.g. lost the final) | `2` |
| `20` | eliminated / never on the podium | `3` (worst) |

```js
const champKey = p => {
  const slot = calcPodiumSlotPts(0, p.podiumArr[0], tournamentState); // 0 | 10 | 20 | null
  return slot === 0 ? 0 : slot === null ? 1 : slot === 10 ? 2 : 3;
};
```

This single criterion is exactly "right champion → still in play → reached podium → eliminated".
It is the one that makes *lost-the-final* beat *out-in-the-round-of-32*, which a clean
alive/dead split would have missed.

### Why there is no "fewer podium points" criterion

An earlier draft had a 5th criterion, "fewer podium points". It's **arithmetically dead** and was
dropped. `total` is built as `gamePts + podiumPts` (`index.html:1638-1639`), so if two players are
tied on **total** (criterion 1) *and* on **group game points** (criterion 3), they are
*necessarily* tied on podium points too (`podium = total − games`). The criterion could never be
the deciding factor — by the time it's reached, it's always already equal. The meaningful podium
signal is the *champion* outcome, which criterion 4 captures directly.

### The new comparator

```js
const champKey = p => {
  const slot = calcPodiumSlotPts(0, p.podiumArr[0], tournamentState);
  return slot === 0 ? 0 : slot === null ? 1 : slot === 10 ? 2 : 3;
};

function compareStandings(a, b) {
  return a.total - b.total          // 1. golf total, lower wins
      || b.exacts - a.exacts        // 2. more exact scorelines
      || a.gamePts - b.gamePts      // 3. fewer group-stage game points
      || champKey(a) - champKey(b); // 4. champion-pick outcome
}

const sameRank = (a, b) =>
     a.total === b.total && a.exacts === b.exacts
  && a.gamePts === b.gamePts && champKey(a) === champKey(b);
```

---

## True ties — shared rank, shared medal

A **true tie** = equal on *all four* criteria (`sameRank` true) — genuinely indistinguishable.
Tied players share a rank *and* a medal, standard competition style: two tied at the front both
show **1 / 🥇**, and the next player is **3 / 🥉** (the 🥈 is skipped). No separate marker — the
repeated rank number *is* the tie signal.

```
🥇  1   ANDRÉ        12   ·  4 exatos
🥇  1   GONÇALO      12   ·  4 exatos
🥉  3   PEDRO        15   ·  3 exatos
```

Rank assignment after sorting (competition ranking — ties share, next rank skips):

```js
mainLb.forEach((p, i) => {
  p.rank = (i > 0 && sameRank(mainLb[i - 1], p)) ? mainLb[i - 1].rank : i + 1;
});
```

The row renderer then drives the medal / `isTop` / position cell off `p.rank` instead of the row
index `i`:

```js
const isTop    = !isObserver && p.rank <= 3;
const showMedal = !isObserver && medals[p.rank - 1];
// position cell: showMedal ? medals[p.rank - 1] : String(p.rank)
```

With two players at rank 1, both get `medals[0]` (🥇) and show "1"; the next at rank 3 gets
`medals[2]` (🥉). Three-way ties extend the same way (1, 1, 1, then 4).

---

## Data model / Backend

None. Pure `index.html` render logic. No change to `calcPts` / `calcPodiumPts` /
`calcPodiumSlotPts` — the comparator *reads* the canonical champion-slot score, it doesn't
redefine it.

## Implementation notes

### Files touched
- `index.html` only.

### Where the logic lives
- **`gamePts`**: capture `const gamePts = total;` before the podium addition in the leaderboard
  row map (`index.html:1638`), and return it on each row object (`index.html:1640`).
- **Comparator + `sameRank`**: define `compareStandings` and `sameRank` once (near the top of
  `renderLeaderboard`, where `tournamentState` is in scope — `index.html:1628`). Replace the inline
  sort at `index.html:1641` with `.sort(compareStandings)`.
- **Ranks**: assign `p.rank` on `mainLb` (and, separately, on `obsLb`) right after the sort,
  before the observer partition consumes them (`index.html:1644`).
- **Row renderer**: switch `isTop` / `showMedal` / the position cell from `i` to `p.rank`
  (`index.html:1700-1703`, `1719`).

### Consistency — one comparator everywhere

The game-day position-change arrows use a *separate, shallower* sort (total + exacts only,
`index.html:922`). Reuse `compareStandings` / `sameRank` there too so the board and the arrows
can't disagree once the deep criteria activate. No visible effect today — criteria 3–4 are
dormant until the group stage ends / the knockouts — but it keeps a single source of truth for
ordering, matching the project's scoring-is-single-source convention. (The frozen delta board is
group-stage-only, where podium is `null` and `gamePts === total`, so the deeper keys are inert
there regardless.)

### Order of work
1. Capture `gamePts` in the row map; return it on each row.
2. Add `compareStandings` + `sameRank`; swap the inline sort to use them.
3. Assign `p.rank`; drive the renderer's medal/position off `p.rank`.
4. Reuse `compareStandings` / `sameRank` in the position-delta sort (`index.html:922`).

---

## Out of scope
- Head-to-head as a tie-break — champion-pick + game points was the chosen direction; H2H is
  more to explain and not wanted.
- Tie-breaking the *runner-up* or *third* podium slots — criterion 4 is champion-only by design;
  anything still tied after it is a genuine tie and shares a rank.
- Showing *why* a tie was broken (e.g. "ahead on champion pick") in the expanded row — possible
  later, not now.
- Changing the dinner-split neutralisation (`index.html:1652`) — already handles ties for its own
  purpose.
- v1 (`goalgut/`).

## Reversibility

Pure render change. Revert by restoring the two-key inline comparator at `index.html:1641` and
driving the renderer off the row index again. No persisted state.

## Testing

- The **shared-rank display** is testable now (group stage is live): it fires whenever two
  players are equal on total + game points + exacts, which already happens. Confirm two tied
  players show the same rank number and medal, and the next player's rank skips correctly.
- **Criteria 3–4** only diverge once the group stage ends / teams are eliminated (late June into
  July). Per the project's "trust code review when the runtime gate hides the surface" default,
  review the comparator carefully rather than waiting. To exercise early, in a branch force
  `groupStageComplete` and seed an `eliminated` set with a champion pick at each slot value
  (`0 / 10 / 20 / null`) and confirm the `0 < null < 10 < 20` ordering. Don't commit the stub.
