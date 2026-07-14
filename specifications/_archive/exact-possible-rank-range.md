# Spec: Exact possible-rank range + exacts as display-only (v0 only)

Amends `_archive/tie-break-ladder-reorder.md` and `_archive/structural-podium-floor.md`.

## Problem

Two related defects surfaced at the semifinal stage, both around the post-group-stage
`Possível: #x – #y` range and its `locked` (green/red dinner) classification.

1. **The range ignored played semifinals.** `minPodiumGap` — the engine behind the range —
   knew only each team's bracket quarter/half and whether it was eliminated. A played semi tells
   us more: the SF *winner* is a guaranteed finalist, the SF *loser* can finish 3rd at best. The
   grey-pill floors (`podiumFloor`) already used this, so the range and the pill contradicted each
   other. Concretely: João Maria showed *Possível #1–#6* while carrying a `+10 🇫🇷` pill — the
   range let França (an SF loser) be runner-up for 0, an outcome the semi had already ruled out.

2. **`minPodiumGap` is a pairwise bound and over-states the best edge.** `bestRank` was
   `1 + (rivals who beat you under EVERY podium)`. That optimises each rival independently and
   picks a different podium per rival, so it can report a `#1` that no single podium delivers.
   Pedro showed *Possível #1* though his true ceiling — across every reachable podium — is #3/#4.

3. **Exacts broke ranks.** Per the standing rule "exact scores are a display-only tiebreak", the
   number of exact scorelines must never move a player to a higher/lower position. But `sameRank`
   included `a.exacts === b.exacts`, and the dinner-cutoff neutralisation keyed on `(total,
   exacts)` — so two players level on the real criteria but differing on exacts were split into
   different ranks, medals, and even opposite sides of the dinner line.

## Goal

- Feed semifinal results into the range so it can never contradict a grey-pill floor.
- Compute the range **exactly** from the reachable-podium enumeration, not the pairwise bound.
- Make exacts truly display-only: it orders the print within a shared rank, never the rank itself.

## Implementation (all in `index.html`)

### 1. SF-aware `minPodiumGap` (retained as the early-stage fallback)

Pass `sf = sfOutcome()` in. In the placement recursion: an SF loser may not occupy a finalist slot
(0/1); an SF winner may not occupy 3rd (slot 2) and may not be left off-podium (it's a locked
finalist). This tightens the bound to agree with the floors. It stays in use only while the exact
engine is dormant (see §2).

### 2. Exact range from the podium enumeration

`enumeratePodiumClasses` (the Contas engine) already sweeps every reachable final podium with the
correct `ts`. Extend it to also compute, per class, each player's **competition rank** using the
live board's own `compareStandings` / `sameRank`, and reduce to `rankRange: id → {best, worst}`
(min/max over all classes). `contasData` returns it; `renderLeaderboard` consumes it.

Range source, in precedence order:
1. **Podium fully decided** (`champion && runnerUp && third`) → `best = worst = board rank`.
2. **Exact engine live** (`contas.rankRange` present) → `{best, worst}` from it.
3. **Fallback** (R32 not fully seeded, or `> CONTAS_MAX_PENDING` pending completions) → the
   SF-aware `minPodiumGap` pairwise bound. Conservative: it may over-state reachability, never
   under-state it.

Because the range now uses the same comparator/ties as the displayed rank AND the same
enumeration as Contas, the range, the shown rank, and the Contas conditions cannot disagree.

### 3. Exacts is display-only

`champKey`↔`champBucket` already models "graded key orders display, coarse key decides rank
equality". Exacts must follow the same split:
- `compareStandings`: keep `b.exacts - a.exacts` as the **last** key (display order within a tie).
- `sameRank`: **remove** exacts. Rank equality = `total → champBucket → gamePts`.
- Dinner-cutoff neutralisation: re-key from `(total, exacts)` to `sameRank`, so a cosmetic count
  can never decide who pays.

## Out of scope

- Changing `calcPts` / `calcPodiumPts` / `calcPodiumSlotPts` — pure ordering/range render logic.
- Head-to-head or runner-up/third tie-breaks — anything level after the real ladder is a true tie.
- v1 (`goalgut/`).

## Testing

- **Exact range** verified against a standalone oracle enumerating all reachable podiums at the
  current (one-semi-played) state: reproduces every `{best, worst}`, incl. Pedro #2–#4 and João
  Maria locked #5. The phantom `#1` for Pedro is gone.
- **Exacts-as-display-only**: two players level on total/champBucket/gamePts but differing on
  exacts now share a rank + medal and the same dinner side; the higher-exacts one still prints
  first. No effect on the current live board (today's 11 totals are all distinct).
