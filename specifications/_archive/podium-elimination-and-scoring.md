# Spec: Podium elimination & scoring — R32-driven (v0 only)

## Problem

Podium scoring is the only thing that moves the leaderboard once the group stage ends, and two
parts of it are currently weaker than they should be — both surfacing now that the knockouts are
near and specs `post-group-stage-podium-bar-chart.md` and
`matches-tab-fase-final-knockout-view.md` both lean on a correct `computeActualTournamentState`.

1. **Group-stage elimination re-derives FIFA's tiebreakers in JS.** `computeActualTournamentState`
   (`index.html:728-737`) computes the best-8 third-placed teams from group standings to decide
   who's eliminated. That logic is fragile — we've already shipped a fix for it
   (`_archive/fix-best-3rd-slot-assignment.md`) — and it's redundant: once the knockout bracket
   is seeded, the R32 fixtures *are* the factual list of who advanced. For match (factual) data,
   the seeded R32 beats re-deriving the cut.
2. **The expanded leaderboard row shows a different scale than it scores.** The row's podium
   breakdown (`index.html:1506`) re-derives points inline on a stale **0/5/10** scale, while the
   authoritative `calcPodiumSlotPts` (`index.html:220`) — which feeds the actual `total` — uses
   **20/10/0**. Two numbers for the same pick. Not a scoring error (the total is right); a display
   that drifted from the single source of truth.

## Goal

- **Confirm and consolidate the 20/10/0 scale** with `calcPodiumSlotPts` as the only implementation.
- **Detect elimination from factual match data**, via two rules:
  - group non-qualifiers come from the **seeded R32**, not a JS tiebreak;
  - knockout losers are eliminated as they lose, with the **semifinal and final carve-outs** that
    keep podium scoring correct.
- **Align the expanded row** (`:1506`) to call `calcPodiumSlotPts`.

**Scope: v0 only.** This is the data/scoring core that specs #1 (bar chart) and #2 (Fase Final)
sit on top of; it should land before or with them.

---

## The scoring scale (confirmed)

Golf scoring, per podium slot 🥇🥈🥉, **lower = better**:

| Outcome | Points |
|---------|-------:|
| Pick is in the correct podium position | **0** |
| Pick is on the podium, wrong position | **10** |
| Pick is not on the podium (or eliminated, or empty) | **20** |

`calcPodiumSlotPts(slotIndex, predicted, tournamentState)` (`index.html:220-232`) already
implements exactly this and stays as-is. It returns `null` while a pick is unresolved (team still
alive, final position unknown) so nothing is scored prematurely. **No other code may re-derive
these numbers** (CLAUDE.md single-source rule).

---

## Elimination model

"Eliminated" means *can no longer finish on the podium* (4th or worse). It's used by
`calcPodiumSlotPts` to lock a 20 as soon as a pick is out of contention, before the final
positions are known.

| Event | Finishes | Eliminated? |
|-------|----------|:-----------:|
| Group stage ends, team absent from the seeded R32 | did not qualify | **Yes** — once R32 is fully seeded |
| Loses R32 / R16 / QF | 5th–16th | **Yes** |
| Loses **semifinal** | drops to 3rd-place match | **No** — bronze still possible |
| Wins 3rd-place match | 3rd | No → sets `third` |
| Loses 3rd-place match | 4th | **Yes** |
| Wins final | 1st | No → sets `champion` |
| Loses **final** | 2nd | **No** → sets `runnerUp` (podium secured) |

The two carve-outs (SF, final) are the whole reason "loses a match → eliminated" can't be applied
blindly: a semifinal loser still has bronze to play for, and the final's loser *is* the runner-up.

### Rule 1 — group non-qualifiers from the seeded R32

Replace the best-thirds block (`index.html:728-737`) with: any team that played the group stage
but appears in **no R32 fixture** is eliminated. Guarded on a **fully seeded R32 (16 matches)** so
a partial seed never flags a real qualifier as out. Until R32 is seeded, group non-qualifiers stay
unresolved (their 20s lock when the bracket lands, not at the final group whistle — an accepted
trade for dropping the fragile tiebreak math).

### Rule 2 — knockout losers, with carve-outs

R32/R16/QF losers eliminated as today (`index.html:740-745`); the SF stage is deliberately *not*
in that loop (so SF losers stay alive for bronze); the 3rd-place match eliminates its loser and
sets `third`; the final sets `champion`/`runnerUp` and eliminates neither. The old SF
un-eliminate block (`index.html:747-751`) becomes dead code — SF losers are never added now — and
is removed.

### The rewrite

```js
function computeActualTournamentState() {
  const eliminated = new Set();
  let champion = null, runnerUp = null, third = null;

  const groupMatches = state.matches.filter(m => m.group_letter && m.group_letter.length === 1);
  const groupStageComplete = groupMatches.length >= 72 && groupMatches.every(m => isFinal(m));
  if (!groupStageComplete) return { champion, runnerUp, third, eliminated, groupStageComplete: false };

  // Rule 1 — group non-qualifiers. The seeded R32 is the factual record of who advanced;
  // any group-stage team absent from it is out. Guarded on a full R32 (16 matches) so a
  // partial seed never flags a real qualifier. Replaces the old best-8-thirds JS.
  const r32 = state.matches.filter(m => m.group_letter === 'R32');
  if (r32.length >= 16) {
    const qualified = new Set();
    r32.forEach(m => { if (m.team_a) qualified.add(m.team_a); if (m.team_b) qualified.add(m.team_b); });
    const groupTeams = new Set();
    groupMatches.forEach(m => { groupTeams.add(m.team_a); groupTeams.add(m.team_b); });
    groupTeams.forEach(t => { if (!qualified.has(t)) eliminated.add(t); });
  }

  // Rule 2 — knockout losers. SF excluded (3rd-place pending); final loser is the runner-up.
  ['R32', 'R16', 'QF'].forEach(stage => {
    state.matches.filter(m => m.group_letter === stage).forEach(m => {
      const w = matchWinner(m);
      if (w) eliminated.add(w === m.team_a ? m.team_b : m.team_a);
    });
  });

  const thirdMatch = state.matches.find(m => m.group_letter === '3P');
  if (thirdMatch) {
    const w = matchWinner(thirdMatch);
    if (w) { third = w; eliminated.add(w === thirdMatch.team_a ? thirdMatch.team_b : thirdMatch.team_a); }
  }

  const finalMatch = state.matches.find(m => m.group_letter === 'F');
  if (finalMatch) {
    const w = matchWinner(finalMatch);
    if (w) { champion = w; runnerUp = w === finalMatch.team_a ? finalMatch.team_b : finalMatch.team_a; }
  }

  // Manual override / PEN edge cases the match data can't resolve cleanly.
  if (!champion && state.actualPodium?.first_place) {
    champion = state.actualPodium.first_place;
    runnerUp = state.actualPodium.second_place;
    third = third || state.actualPodium.third_place;
  }

  return { champion, runnerUp, third, eliminated, groupStageComplete: true };
}
```

`matchWinner` (`index.html:210-218`) already resolves penalty shootouts via the `pen-home` /
`pen-away` statuses, so the manual `actualPodium` fallback only covers cases the feed can't
express. Dropping the best-thirds block leaves `computeGroupStandings` (the `computeStandings`
wrapper over actual results) with no callers — the standings UI uses `computePredictedStandings`
instead — so it's removed as dead code.

---

## Aligning the expanded row

Swap the inline 0/5/10 derivation (`index.html:1503-1512`) for the canonical scorer:

```js
...["🥇","🥈","🥉"].map((medal, mi) => {
  const predicted = p.podiumArr[mi];
  const pPts = calcPodiumSlotPts(mi, predicted, tournamentState);   // 0 | 10 | 20 | null
  const dotColor = pPts === 0 ? "#10b981" : pPts === 10 ? "#fbbf24" : pPts === 20 ? "#ef4444"
                 : "rgba(255,255,255,0.2)";
  return h("div", { /* …unchanged card… */ },
    h("div", { /* … */ }, medal),
    h("div", { /* … */ }, predicted ? (flagOf(predicted) || predicted) : "—"),
    pPts !== null ? h("div", { /* …, color: dotColor */ }, `${pPts} pts`) : null
  );
})
```

After this, all three podium surfaces — the leaderboard `total`, the expanded breakdown, and the
spec-#1 bar chart — read one function on one scale.

---

## Data dependency — knockout results must flow

Rule 2 is **inert without knockout scores**, and today they can't arrive:

- `poll-results` pairs upstream fixtures to our rows **only on `fd_match_id`**
  (`supabase/functions/poll-results/index.ts:108`) — no stage filter, so KO rows are otherwise
  eligible by kickoff window + status.
- But `seed-knockout.js` inserts KO rows with **`fd_match_id` unset** (`seed-knockout.js:98-105`),
  so they never pair and never get scored. The poller would even warn "started but no upstream
  result (fd_match_id=null)."

**Required companion change:** have `seed-knockout.js` store football-data's match id as
`fd_match_id` on insert — the same id the poller compares against (`match.id`), and the same key
the group rows already use (seeded by `seed-fd-ids.js`):

```js
const row = {
  group_letter: stage,
  team_a: teamA,
  team_b: teamB,
  kickoff: m.utcDate,
  fd_match_id: m.id,        // ← pair key for poll-results; without it KO scores never land
  venue: "",
  status: "scheduled"
};
```

Verify during implementation that `match.id` here equals the value `seed-fd-ids.js` wrote for
group rows (it should — same competition feed). The *operational* steps (running
`seed-knockout.js` after each round, confirming the cron is active) stay outside this spec.

---

## Implementation notes

### Files touched

- `index.html` — `computeActualTournamentState` rewrite + the `:1506` alignment.
- `seed-knockout.js` — one-line `fd_match_id: m.id` addition (required companion).

No DB schema change (`matches.fd_match_id` already exists), no Edge Function change.

### Where the logic lives

- Elimination: `computeActualTournamentState`, `index.html:720-775` (replace 728-737, drop
  747-751).
- Expanded-row display: `index.html:1503-1512` inside `renderLeaderboard`.
- Pair key: `seed-knockout.js:98-105`.

### Order of work

1. Rewrite `computeActualTournamentState` (rule 1 via R32, rule 2 carve-outs, drop SF block).
2. Align `:1506` to `calcPodiumSlotPts`; fix `dotColor` thresholds to 0/10/20.
3. Add `fd_match_id: m.id` to `seed-knockout.js`.

---

## Out of scope

- **The 20/10/0 values themselves** — confirmed, not changing; only consolidating their one
  implementation.
- **Running `seed-knockout.js` / cron operations** — operational; this spec makes the code correct
  so that when it runs, scores flow and scoring resolves.
- **Bar chart and Fase Final rendering** — specs #1 and #2; they consume this state.
- **v1 (`goalgut/`).**

## Reversibility

`computeActualTournamentState` and the `:1506` change are pure frontend, gated behind
`groupStageComplete`; before the group stage ends they're unreachable/no-ops. The
`seed-knockout.js` line is additive (a column that was null becomes populated) and harmless to the
group pipeline. Reverting is restoring the old function body and dropping the one line.

## Testing

Gated on `groupStageComplete` (≈27 June) and on seeded KO data, so it can't be checked live until
then — per the project's "trust code review when the runtime gate hides the surface" default,
review carefully. To exercise early in a branch, force `groupStageComplete` and seed a small KO
set, then verify against hand-computed expectations:

- a group non-qualifier → eliminated only after a full 16-match R32 is present;
- an R32/R16/QF loser → eliminated; an SF loser → **not** eliminated until the 3rd-place match;
- 3rd-place winner → `third` (pick scores 0/10), its loser → eliminated (20);
- final winner/loser → `champion`/`runnerUp`, neither eliminated;
- the expanded row and the leaderboard total show identical podium points for the same pick.

Don't commit the stub. Separately, after a real `seed-knockout.js` run, confirm a KO row gets a
non-null `fd_match_id` and that `poll-results` pairs it (watch the function logs for the
no-longer-appearing "fd_match_id=null" warning).
