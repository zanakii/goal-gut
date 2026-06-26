# Spec: Structural podium floor — bracket-guaranteed points (v0 only)

## Problem

Podium scoring is entirely results-driven. `computeActualTournamentState` (`index.html:911`) only adds a team to `eliminated` after it *actually* loses a knockout match (or is absent from the seeded R32), and `calcPodiumSlotPts` (`index.html:250`) returns `null` for any pick whose team is still alive. So a pick's `+20` penalty lands only at the instant a real result confirms it.

But the bracket geometry guarantees some of those penalties the moment the R32 is drawn, before a single knockout ball is kicked. The podium is the three best of the four semifinalists (two finalists + the bronze-playoff winner), and the bracket has **four quarters** — 8-team regions, each feeding exactly one semifinalist. So **at most one team per quarter can ever reach the podium.** If a player has, say, Brasil and Argentina both on their 1-2-3 podium and FIFA seeds them into the same quarter, one of them *cannot* podium — the player is already certain to eat at least `+20`. Today nothing surfaces that until one of the two actually goes out, which could be three weeks later.

The people who feel this are the whole pool, from the R32 draw onward: the leaderboard and the post-group-stage bar chart both under-tell the story, hiding points that are already mathematically locked.

## Goal

- **Surface the bracket-guaranteed floor as a projection, the instant the R32 is seeded** — a `+20` / `+40` indicator, distinct from the real total.
- **Never move the total on a prediction.** The leaderboard `total` keeps reading *only* the results-driven `eliminated` set. The floor is a separate pill that walks itself down to zero as collisions resolve into real eliminations.
- **Compute it from the FIFA R32 alone**, with no best-thirds re-derivation — the fragile cut math we deliberately dropped in `_archive/podium-elimination-and-scoring.md` stays dropped.
- **Render it on the bar chart as a pending (grey) segment** that gives way to a full-colour scored segment when the collision materialises.

**Scope: v0 only.** An additive structural layer on top of `calcPodiumSlotPts` / `computeActualTournamentState` — it does not touch the 20/10/0 scale, the `eliminated` set, or the tie-break ladder. Sits alongside `_archive/post-group-stage-podium-bar-chart.md` (which owns the *scored* segments) and `_archive/podium-elimination-and-scoring.md` (which owns real elimination). Gated behind `groupStageComplete` **and** a fully seeded R32 (16 rows) — dormant until the bracket lands.

---

## The geometry (why one rule is exact)

A team is on the podium **iff it reaches the semifinals**. The four quarters each yield exactly one semifinalist, so each quarter contributes **at most one** podium team. Quarter membership, read straight off the static tree (`R32`/`R16`/`QF`, `index.html:832-865`):

| Quarter | R32 slots | R16 slots | QF |
|---------|-----------|-----------|----|
| QF0 | 0, 1, 2, 4 | 0, 1 | 0 |
| QF1 | 8, 9, 10, 11 | 4, 5 | 1 |
| QF2 | 3, 5, 6, 7 | 2, 3 | 2 |
| QF3 | 12, 13, 14, 15 | 6, 7 | 3 |

The guaranteed floor over a player's still-alive podium picks is therefore:

```
floor = Σ_quarters  20 × max(0, alivePicksInQuarter − 1)
```

With all three picks alive this reduces to `20 × (3 − distinctQuartersOccupied)`: three different quarters → `0`; two picks sharing a quarter → `+20`; all three in one quarter → `+40`. The "≤ 2 podium teams per half" constraint never adds anything beyond this — three picks in one half force a shared quarter by pigeonhole — so the quarter rule alone is exact. The general `Σ max(0, n−1)` form (not the all-alive shortcut) is what we implement, so the pill stays correct as picks drop out one at a time.

---

## Resolving a seeded R32 row to its quarter

The crux, and the reason no best-thirds math is needed. Each static R32 slot has at least one side that is a group **winner or runner-up** (slots are winner-vs-third, winner-vs-runner-up, or runner-up-vs-runner-up — never third-vs-third). Group 1st/2nd place are read trivially from the **actual** final standings. So we pin each seeded row to its slot via the resolvable side, and the third-placed team is simply "whoever FIFA put in the other half of that row":

```js
// Quarter membership by R32 slot — straight off the static bracket tree (index.html:832-865).
const QUARTERS = [[0,1,2,4], [8,9,10,11], [3,5,6,7], [12,13,14,15]]; // QF0..QF3
const slotQuarter = slot => QUARTERS.findIndex(q => q.includes(slot));

// concrete team → quarter, for every team in the seeded R32.
function buildTeamQuarter() {
  const r32Rows = state.matches.filter(m => m.group_letter === 'R32');
  if (r32Rows.length < 16) return {};                       // partial seed → dormant

  const standings = computeStandings(state.matches, m => ({ sa: m.score_a, sb: m.score_b }));
  const resolve = ph => {                                   // winner/runner-up → concrete team
    if (ph.type === 'third') return null;                   // third is a wildcard, resolved below
    const t = standings[ph.group];
    return ph.type === 'winner' ? t?.[0]?.team : t?.[1]?.team;
  };
  const slotByTeam = {};                                    // each group winner/RU sits in exactly one slot
  R32.forEach(({ slot, a, b }) => [a, b].forEach(ph => {
    const team = resolve(ph); if (team) slotByTeam[team] = slot;
  }));

  // Walk the seeded rows so the *third* side inherits its row's quarter too.
  const teamQuarter = {};
  r32Rows.forEach(m => {
    const slot = slotByTeam[m.team_a] ?? slotByTeam[m.team_b];
    if (slot == null) return;
    const q = slotQuarter(slot);
    teamQuarter[m.team_a] = q; teamQuarter[m.team_b] = q;
  });
  return teamQuarter;
}
```

`computeStandings` (`index.html:880`) already exists and is the single source for group tables; feeding it the real scores gives the actual final standings. No new standings code, no thirds combinatorics.

## The per-player floor

```js
// Bracket-guaranteed pending points for one player. Considers only ALIVE, qualified picks —
// an eliminated pick already scores a real 20 in `total`; a non-qualifier is already eliminated
// by Rule 1. Never touches ts.eliminated.
function podiumFloor(p, ts, teamQuarter) {
  const byQuarter = {};
  (p.podiumArr || []).forEach(t => {
    if (!t || ts.eliminated.has(t) || teamQuarter[t] == null) return;
    (byQuarter[teamQuarter[t]] ??= []).push(t);
  });
  let pending = 0; const drivers = [];
  Object.values(byQuarter).forEach(teams => {
    if (teams.length > 1) { pending += 20 * (teams.length - 1); drivers.push(teams); }
  });
  return { pending, drivers };   // pending ∈ {0, 20, 40}; drivers = the colliding pair(s)/trio
}
```

**Materialisation.** When a colliding team actually loses, it enters `eliminated` the normal way → its real `+20` lands in `total` → it drops out of `alive` here → `pending` falls by 20. The total only ever moved on the result. Nothing in `podiumFloor` writes to `eliminated`, `compareStandings`, or `sameRank` (`index.html:302-314`) — rank and total stay 100% results-driven, by construction.

---

## User-facing surfaces

### Leaderboard list — the pill

Under the row of any player with `pending > 0`, a small grey pill beneath the total — flags only, no text reason (the grey tone + the dedicated styling carry the "pending, not scored" meaning; the tooltip/bar caption spells it out for anyone who wants it):

```
  Pedro                              42
    +20  🇧🇷 🇦🇷
```

- `+20` or `+40`, in a muted grey treatment so it never reads as part of the scored total.
- Followed by the colliding teams' flags (`flagOf`, used throughout). Two separate pairs can't occur with three picks, so the pill is always one driver group (a pair → two flags, a trio → three).
- Disappears the moment `pending` hits 0.

### Bar chart — pending segment

On the post-group-stage bar chart (`_archive/post-group-stage-podium-bar-chart.md`), add a **fifth stacked dataset** on top of the three podium slots, carrying `pending` per player, rendered as a **solid grey segment** at the height it will occupy once it materialises:

```js
// 5th dataset, stacked above 🥇🥈🥉 (slotDataset pattern, index.html:516-548)
{
  label: "Garantido (pendente)",
  data: players.map(p => podiumFloor(p, ts, teamQuarter).pending),
  backgroundColor: players.map(p => p.is_observer ? "rgba(148,163,184,0.22)" : "rgba(148,163,184,0.45)"),
  stack: "s",
}
```

Grey, not a hollow/dashed border: Chart.js renders `borderDash` on bar elements inconsistently across versions, and a solid grey fill reads unambiguously as *provisional* against the outcome colours — amber `rgba(251,191,36,…)` (wrong slot) and red `rgba(239,68,68,…)` (off podium). The base group segment is faint white `rgba(255,255,255,0.18)`, so mid grey is distinct from both the base and the scored segments. Observers dimmed, matching the rest of the chart.

Datalabel/tooltip on this segment reads the `drivers` to compose a flags-only line, e.g. **`🇧🇷 🇦🇷 +20`**. When the collision materialises, this grey segment shrinks to 0 and the corresponding 🥇/🥈/🥉 slot segment fills solid red via the existing `slotData`/`slotFill` path — no special-casing the flip; it's just the floor dataset losing height while the real slot gains it.

### Expanded row

The per-slot dots (`index.html:~1888`) are **not** touched. When two picks collide we know one of the two slots will be `+20` but not which until they play, so the floor can't honestly attach to a single 🥇/🥈/🥉 dot. It lives only at the aggregate level — the list pill and the bar's pending segment.

---

## Implementation notes

### Files touched

Only `index.html`. No DB schema change, no Edge Function change, no change to `seed-knockout.js` (it already lands R32 rows with `fd_match_id` per `_archive/podium-elimination-and-scoring.md`).

### Where the logic lives

- **`buildTeamQuarter()` + `podiumFloor(p, ts, teamQuarter)`** — new helpers next to `computeActualTournamentState` (`index.html:911`). Both pure, both no-ops until 16 R32 rows + `groupStageComplete`.
- **Leaderboard render** (`index.html:~1756`): compute `teamQuarter` once per render; for each player call `podiumFloor` and emit the pill when `pending > 0`. Reuses the `podiumArr` already on each row.
- **Bar chart** (`buildPodiumBarChart`, datasets at `index.html:~516-548`): add the fifth dataset + its datalabel/tooltip.
- **No change** to `calcPodiumSlotPts`, `calcPodiumPts`, `computeActualTournamentState`, `compareStandings`, `sameRank`.

### Order of work

1. `buildTeamQuarter()` — verify slot resolution against the real seeded R32 once it lands.
2. `podiumFloor()` — unit-check the `{0,20,40}` cases by hand.
3. Leaderboard pill (grey, flags only).
4. Bar chart pending dataset + label + the materialisation give-way.

---

## Out of scope

- **The 20/10/0 scale and the `eliminated` set** — unchanged; this only reads them.
- **Tie-breaks / ordering** — the floor is explicitly excluded from `compareStandings`/`sameRank`; rank follows the real total only.
- **Per-slot attribution** — deliberately not pinned to a medal slot (see Expanded row).
- **Echoing the pill in the expanded row** — kept to the collapsed row + bar, to avoid duplication.
- **Later rounds** — once R16/QF are seeded the same quarters just hold fewer alive teams; no new logic. The helper reads whatever R32 rows exist and the `alive` filter handles the rest.
- **Running `seed-knockout.js`** — operational (Monday); the spec/logic don't depend on it, only verification does.
- **v1 (`goalgut/`).**

## Reversibility

Pure additive frontend, gated on `groupStageComplete` + 16 R32 rows — until the bracket is seeded, `buildTeamQuarter` returns `{}`, every `pending` is 0, and nothing renders. Reverting is deleting the two helpers, the pill, and the fifth dataset.

## Testing

Gated until the R32 is seeded (Monday-ish), so it can't be verified live before then — per the project's "trust code review when the runtime gate hides the surface" default, review carefully. To exercise early in a branch: force `groupStageComplete`, seed 16 synthetic R32 rows whose pairings put a known pair (e.g. Brasil + Argentina) in one quarter, and confirm `podiumFloor` returns `+20` for a player holding both, `+40` for three-in-one-quarter, `0` for three distinct quarters; then mark one colliding team's R32/R16/QF loss final and confirm the pill drops by 20 while the real total rises by 20 (no double-count). Verify `buildTeamQuarter` pins every row to the correct quarter against the hand-drawn bracket — especially the winner-vs-third rows, where only one side is resolvable. Don't commit the stub.
