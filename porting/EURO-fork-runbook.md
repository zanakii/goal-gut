# Runbook: fork the WC skeleton into a EURO edition

**Audience:** whoever forks this codebase into a UEFA Euro edition (24-team, 6-group format — Euro 2028 onward).
**Premise:** this is a **one-time structural fork**, not a data reseed. You pay the format cost *once*; afterwards the Euro fork is as plug-and-play across future Euros as the WC fork is across World Cups (use the WC runbook's pattern for each subsequent Euro — same steps, code `EC`, 36 matches, A–F).

The Euro is *not* a smaller World Cup. Three things genuinely differ: **6 groups not 12**, **a Round of 16 entry (no R32)**, and — the one that isn't mechanical — **no third-place match**.

> **References are by symbol, not line number.** `index.html` opens with a `TOURNAMENT CONFIG` fork manifest naming every variant symbol below; search the file for the name.

---

## ⚠️ Decide this FIRST: what is a "podium" without a bronze match?

UEFA has not played a third-place match since 1980. The entire 1-2-3 podium mechanic — and the structural-floor and elimination features — assume bronze is decided on the pitch. It isn't. **3rd place is undefined in a Euro.** This is a product decision, not a config edit, and it gates most of the rewrite below. Pick one:

- **Option A — champion + runner-up (2-slot podium). Recommended.** Most faithful: these are the only two positions the tournament objectively ranks. Podium picks drop from three to two; the bracket draft, podium card, expanded-row dots, and bar-chart slot datasets all become 2-slot. **Floor region becomes the half** (each half yields exactly one finalist, so two podium picks in the same half are a guaranteed collision → ≥20).
- **Option B — keep three slots, define 3rd as "either semifinal loser."** Minimal UX churn (the 1-2-3 draft survives), but messy: there are two joint-3rd teams and golf scoring wants one. A bronze pick would score 0 if it's *either* SF loser. **Floor stays quarter-based** (≤1 podium team per quarter), as in the WC.

The rest of this runbook flags `[Option A]` / `[Option B]` where the path forks. **Do not start coding until this is chosen.**

---

## What stays unchanged (the engine — most of the app)

You are forking a thin costume, not rebuilding. Untouched:
- Players, PINs, server-side PIN verification, observers, reveal gates, audit export.
- Golf scoring scale + `badgeColor`, the leaderboard, the tie-break ladder (`compareStandings` / `sameRank` — see `specifications/_archive/one-rank-authority-canonical-tiebreak-ladder.md`), dinner split, position arrows, fun-facts.
- The live-results mechanism (`poll-results`, pairing on `fd_match_id`) — only the competition code changes.
- All five Edge Functions, the `tournament_config` table, the seed-script *structure* (`seed-matches.js`, `seed-fd-ids.js`, `seed-knockout.js`).
- The slot-resolution trick: resolve each KO row to its bracket slot via the group winner/runner-up side (trivial from standings), third falls out — **no best-thirds JS**, exactly as in the WC fork. It ports as-is to the Euro R16.

---

## Step 0 (before any config edit): make that list above *provable*

Everything in "What stays unchanged" is, as written, a **claim in a markdown file**. Nothing in the code enforces it. If some supposedly format-invariant function quietly reads a World Cup constant, you find out in June, in front of everyone.

Make it checkable first — one afternoon, before you touch a single config value:

1. **Save WC2026 as a replay dataset.** Dump the finished tournament to JSON — `matches` (results + status), `predictions`, `podium_predictions`, `bracket_predictions`, `players`. Column-whitelist it: **this repo is public, so PIN hashes must not go in** (names and predictions are already public at goalgut.gg, so those cost nothing). `db-snapshot.js` has the read-only connection pattern to copy; write a sibling script, don't modify it.

2. **Make `TOURNAMENT CONFIG` injectable.** Today the engine reads `GROUP_MATCH_COUNT`, the bracket tree, `PODIUM_QUARTERS` etc. as module-level constants. Change the engine's entry points to take a config object instead. **This is the actual deliverable** — the test is just what proves it worked. Once config is a parameter, the WC test can hand in a frozen WC config while the live app hands in the Euro's, and any "engine" function still reaching for a global constant fails loudly and immediately. That failure list *is* your true engine/costume boundary, replacing the one this document currently asserts on trust.

3. **Assert the known-good outcome.** Replay WC2026 and check the real final board: Pedro Miguel 248 (1st), José Maria 256, Miguel 258, six payers of eleven, Espanha champion, per-player exact counts. Use `node:test` — built in; this repo has two dependencies and should keep it that way. No production change is needed to run it: the engine functions read a global `state`, so the harness can eval the script block out of `index.html` in a `node:vm` context and set `state` itself.

4. **Add mid-tournament cut points.** The final board only exercises the *end* of the engine. `podiumFloor`, `contasData`/`rankRange`, `minPodiumGap` and the game-day deltas are only meaningful mid-tournament — the subtlest code in the file, and the code a single end-state replay never touches. Chop the same dataset at the group-stage end, after QF, after SF, and assert at each. Nearly free; it's the same data filtered by date.

Then fork. From here on, every change you make gets an instant verdict: **WC2026 still scores 248 → you edited costume. It doesn't → you edited engine.** Re-pinning the numbers because the Euro genuinely changes a rule is fine and expected (podium arity under Option A, for one) — doing it *without noticing* is the failure this prevents.

Skipping Step 0 is defensible if you're in a hurry. Just know that you're then porting on the strength of a paragraph someone wrote in 2026.

---

## The structural rewrites (the fork cost)

### 1. Group count & size
- `GROUP_MATCH_COUNT` → **`36`**. It's a single named constant in the fork manifest now — one edit, no longer two scattered spots.
- Group letters become **A–F**. `isGroupMatch` tests `group_letter` against `/^[A-L]$/`, which already matches A–F and rejects the KO stage codes, so the discriminator holds unchanged (narrow the range to `/^[A-F]$/` only if you want to be strict).
- 6 groups × 4 teams = 24; 36 group matches.

### 2. The bracket tree (the `R32` / `R16` / `QF` / `SF` arrays + `BRACKET_STRUCTURE`)
- **Delete the `R32` array.** The Euro's first KO round is the **Round of 16** (8 matches): 6 group winners + 6 runners-up + 4 best third-placed.
- **Rewrite `R16`** as the entry round, with UEFA's group-position placeholders (`{type:'winner'|'runnerup'|'third', group/groups}`) per the official Euro bracket + the best-4-thirds combination table.
- **Re-chain** `QF` ← R16, `SF` ← QF, `final` ← SF (the 4-quarter / 2-half shape is intact; it just feeds from R16).
- **Remove the `3P` entry** from `BRACKET_STRUCTURE`. `[Option B]`: keep a notion of "SF losers" but render no bronze fixture.

Note: several `R32.length` references (e.g. the "R32 fully seeded" guards) key off the *deleted* array — re-point them to `R16.length` (see step 3).

### 3. `computeActualTournamentState`
- **Rule 1 guard:** `r32.length >= R32.length` → the **R16** round, `r16.length >= R16.length` (8). Non-qualifiers still derive from the seeded first KO round — same trick, new round.
- **KO-loser loop** (`['R32','R16','QF']`): drop `R32`; `[Option A]` → `['R16','QF','SF']` (SF losers ARE eliminated — no bronze to play for); `[Option B]` → `['R16','QF']` (SF losers stay alive as joint-3rd).
- **Delete the `3P` block.** `[Option A]`: remove `third` from the returned state and from `actual = [champion, runnerUp, third]` in `calcPodiumSlotPts`.
- **Final** block unchanged: champion / runner-up.

### 4. Podium scoring & UX
- `calcPodiumPts` loops `for (i=0; i<3; i++)` → `[Option A]` make it 2 slots (`i<2` or `podiumArr.length`); `[Option B]` keep 3.
- `[Option A]` Bracket draft, podium card, expanded-row dots, and the bar-chart slot datasets (`slotDataset` in `buildPodiumBarChart` — three datasets 🥇🥈🥉) all drop to two slots.
- `[Option A]` The ranking layer reads only the champion slot (`calcPodiumSlotPts(0, …)` via `correctChamp` / `champDeadness`), so it survives a 2-slot podium untouched — no tie-break change needed.

### 5. Structural-podium-floor (`specifications/_archive/structural-podium-floor.md`)
The geometry generalizes; the parameters change:
- `[Option A]`: floor region = **half** (not quarter). Recompute the region sets from the new R16 tree; the rule becomes "two podium picks in the same half → ≥20." `buildTeamQuarter` becomes `buildTeamHalf`; `podiumFloor` is otherwise identical (`Σ 20×max(0, aliveInRegion−1)`).
- `[Option B]`: floor stays quarter-based; just recompute `PODIUM_QUARTERS` from the R16 tree (each quarter = the R16 matches feeding one QF). The pill/segment logic is unchanged.
This spec is unbuilt at fork time — port whichever variant matches the decision.

### 6. Feed competition code
football-data.org uses **`EC`** for the European Championship (verify against their current competition list). Change the fetch URL/competition in `seed-fd-ids.js`, `seed-knockout.js`, and the day-window fetch in `poll-results/index.ts`. The pairing-on-`fd_match_id` logic is unchanged.

### 7. Roster + name map (`team-map.js`)
Full European roster, football-data-English → Portuguese. Many WC entries are reusable (most European nations already appear); add the rest.

### 8. Schedule + timezone (`seed-matches.js`)
- Rebuild `MATCHES`: 36 group fixtures, groups A–F, venues.
- **Host timezone — happily a no-op for 2028:** UK & Ireland run on BST (UTC+1), the same offset as 2026's WEST, so `GAME_DAY_ROLLOVER_UTC_HOUR = 8` stays correct and the June/July `pg_cron` gate is unchanged. Re-check this for any later Euro with a different host.

### 9. Copy / branding
Replace `WC2026` / World-Cup strings with the Euro edition; group selectors reflect A–F.

---

## One-line summary
Halve the groups (12→6), make the Round of 16 the bracket entry, **delete the bronze and decide what "podium" means without it**, swap the feed code to `EC` and the roster to Europe — the scoring engine, live pipeline, and social layer ride along untouched.
