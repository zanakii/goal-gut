# Runbook: fork the WC skeleton into a EURO edition

**Audience:** whoever forks this codebase into a UEFA Euro edition (24-team, 6-group format — Euro 2028 onward).
**Premise:** this is a **one-time structural fork**, not a data reseed. You pay the format cost *once*; afterwards the Euro fork is as plug-and-play across future Euros as the WC fork is across World Cups (use the WC runbook's pattern for each subsequent Euro — same steps, code `EC`, 36 matches, A–F).

The Euro is *not* a smaller World Cup. Three things genuinely differ: **6 groups not 12**, **a Round of 16 entry (no R32)**, and — the one that isn't mechanical — **no third-place match**.

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
- Golf scoring scale + `badgeColor` (`index.html:221`), the leaderboard, tie-break ladder, dinner split, position arrows, fun-facts.
- The live-results mechanism (`poll-results`, pairing on `fd_match_id`) — only the competition code changes.
- All five Edge Functions, the `tournament_config` table, the seed-script *structure* (`seed-matches.js`, `seed-fd-ids.js`, `seed-knockout.js`).
- The slot-resolution trick: resolve each KO row to its bracket slot via the group winner/runner-up side (trivial from standings), third falls out — **no best-thirds JS**, exactly as in the WC fork. It ports as-is to the Euro R16.

---

## The structural rewrites (the fork cost)

### 1. Group count & size
- `groupMatches.length >= 72` → **`>= 36`** in **both** spots (`index.html:917` and `:1569`).
- Group letters become **A–F**. The `group_letter.length === 1` KO/group discriminator still holds (A–F are single chars), so no change there.
- 6 groups × 4 teams = 24; 36 group matches.

### 2. The bracket tree (`index.html:832-877`)
- **Delete the `R32` array.** The Euro's first KO round is the **Round of 16** (8 matches): 6 group winners + 6 runners-up + 4 best third-placed.
- **Rewrite `R16`** as the entry round, with UEFA's group-position placeholders (`{type:'winner'|'runnerup'|'third', group/groups}`) per the official Euro bracket + the best-4-thirds combination table.
- **Re-chain** `QF` ← R16, `SF` ← QF, `final` ← SF (the 4-quarter / 2-half shape is intact; it just feeds from R16).
- **Remove the `3P` entry** from `BRACKET_STRUCTURE` (`index.html:875`). `[Option B]`: keep a notion of "SF losers" but render no bronze fixture.

### 3. `computeActualTournamentState` (`index.html:911`)
- **Rule 1 guard:** `r32.length >= 16` → the **R16** round, `>= 8` (`index.html:923-924`). Non-qualifiers still derive from the seeded first KO round — same trick, new round.
- **KO-loser loop** (`['R32','R16','QF']`, `index.html:934`): drop `R32`; `[Option A]` → `['R16','QF','SF']` (SF losers ARE eliminated — no bronze to play for); `[Option B]` → `['R16','QF']` (SF losers stay alive as joint-3rd).
- **Delete the `3P` block** (`index.html:942-946`). `[Option A]`: remove `third` from the returned state and from `actual = [champion, runnerUp, third]` in `calcPodiumSlotPts` (`index.html:253`).
- **Final** block unchanged (`index.html:949`): champion / runner-up.

### 4. Podium scoring & UX
- `calcPodiumPts` loops `for (i=0; i<3; i++)` (`index.html:267`) → `[Option A]` make it 2 slots (`i<2` or `podiumArr.length`); `[Option B]` keep 3.
- `[Option A]` Bracket draft, podium card, expanded-row dots (`index.html:~1888`), and bar-chart slot datasets (`slotDataset`, `index.html:516-548` — three datasets 🥇🥈🥉) all drop to two slots.

### 5. Structural-podium-floor (`specifications/structural-podium-floor.md`)
The geometry generalizes; the parameters change:
- `[Option A]`: floor region = **half** (not quarter). Recompute the region sets from the new R16 tree; the rule becomes "two podium picks in the same half → ≥20." `buildTeamQuarter` becomes `buildTeamHalf`; `podiumFloor` is otherwise identical (`Σ 20×max(0, aliveInRegion−1)`).
- `[Option B]`: floor stays quarter-based; just recompute `QUARTERS` from the R16 tree (each quarter = the R16 matches feeding one QF). The pill/segment logic is unchanged.
This spec is unbuilt at fork time — port whichever variant matches the decision.

### 6. Feed competition code
football-data.org uses **`EC`** for the European Championship (verify against their current competition list). Change the fetch URL/competition in `seed-fd-ids.js`, `seed-knockout.js`, and the day-window fetch in `poll-results/index.ts`. The pairing-on-`fd_match_id` logic is unchanged.

### 7. Roster + name map (`team-map.js`)
Full European roster, football-data-English → Portuguese. Many WC entries are reusable (most European nations already appear); add the rest.

### 8. Schedule + timezone (`seed-matches.js`)
- Rebuild `MATCHES`: 36 group fixtures, groups A–F, venues.
- **Host timezone — happily a no-op for 2028:** UK & Ireland run on BST (UTC+1), the same offset as 2026's WEST, so `GAME_DAY_ROLLOVER_UTC_HOUR = 8` (`index.html:970`) stays correct and the June/July `pg_cron` gate is unchanged. Re-check this for any later Euro with a different host.

### 9. Copy / branding
Replace `WC2026` / World-Cup strings with the Euro edition; group selectors reflect A–F.

---

## One-line summary
Halve the groups (12→6), make the Round of 16 the bracket entry, **delete the bronze and decide what "podium" means without it**, swap the feed code to `EC` and the roster to Europe — the scoring engine, live pipeline, and social layer ride along untouched.
