# Spec: Leaderboard position changes & fun facts (v0 only)

## Problem

The leaderboard tells you where everyone stands *now*, but never how they *got there*. Points
tick up continuously as scores land (`calcPts` resolves the moment `score_a` is set), so there's
no built-in "before/after" — open the app in the morning and you can't see that last night's
matches bumped you up three places, or that Ana's champion pick crashed out and dropped her four.
That overnight reshuffle is the single most fun, most bant-able moment of the pool, and it's
currently invisible: by the time you look, the dust has already settled into a static list.

The instinct "show changes after a match ends" stalls on the continuous-scoring problem — but
position changes don't need continuous diffing. They need a **checkpoint** to compare against, and
the matches themselves hand us a natural one.

## Goal

- When a player opens the app, show **how each position changed over the last game day** — per-row
  rank arrows (▲/▼/–), not point deltas.
- Surface a **"Desde [data]" highlights card** — the fun facts of the last game day (biggest
  movers, overtakes, lead changes, exact calls, podium eliminations, dinner-zone crossings) — so
  the group has a shared thing to mock and praise.
- Do it with **zero new infrastructure**: derive both rankings from match data already in the
  client. No snapshot table, no write triggers.

**Scope: v0 only.** Themed on the friend-group pool's daily rhythm. Builds on
`podium-elimination-and-scoring.md` (needs its `computeActualTournamentState`) and complements
`post-group-stage-podium-bar-chart.md` (bars show *why* points moved; arrows show *the rank
consequence*).

---

## Core model — the "game day" checkpoint

WC2026 is in the Americas, so the slate runs over the European night and there's a dead zone every
Lisbon morning/afternoon (roughly 07:00–18:00, no matches). A calendar-midnight boundary would
slice one night's matches across two days; the morning lull is the honest seam.

**A game day runs 09:00 Lisbon → 09:00 Lisbon**, so a full night of football is one game day. The
whole tournament (11 Jun – 19 Jul) sits in Lisbon summer time (WEST = UTC+1), so the rollover is a
single constant — **08:00 UTC** — with no DST edge cases.

```js
// 09:00 Europe/Lisbon == 08:00 UTC for the entire tournament (WEST).
const GAME_DAY_ROLLOVER_UTC_HOUR = 8;

// Match kickoffs are stored UTC-naive; parse as UTC (the poller already does `kickoff + "Z"`,
// supabase/functions/poll-results/index.ts:152). Confirm the stored format on implementation.
const kickoffMs = m => new Date(m.kickoff.endsWith("Z") ? m.kickoff : m.kickoff + "Z").getTime();

// The 09:00-Lisbon instant that opens the game day a given time belongs to.
function gameDayStart(ms) {
  const d = new Date(ms);
  const boundary = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), GAME_DAY_ROLLOVER_UTC_HOUR);
  return ms >= boundary ? boundary : boundary - 24 * 3600 * 1000;
}
```

### Which game day we compare

We show the movement of the **last *completed* game day that actually had matches** — and freeze
it until the next 09:00 rollover.

```js
function lastCompletedGameDay(now) {
  const starts = [...new Set(
    state.matches.filter(isFinal).map(m => gameDayStart(kickoffMs(m)))
  )]
    .filter(start => now >= start + 24 * 3600 * 1000)   // window fully closed
    .sort((a, b) => a - b);
  if (!starts.length) return null;
  const A = starts[starts.length - 1];                  // baseline: start of that game day
  return { A, B: A + 24 * 3600 * 1000 };                // comparison: its close
}
```

- **Frozen & shared.** Deltas compare ranks at `A` vs ranks at `B`. Open the app at noon or at
  22:00 mid-match — everyone sees the *same* "since yesterday" story; tonight's results roll in at
  tomorrow's 09:00. Your ▲4 is my ▲4, which is what makes it bant-able.
- **Empty days skipped.** Because we only consider game-day windows that contain a finished match,
  rest days (group→R32, between KO rounds) are stepped over — the arrows always reflect the last
  *real* batch, never a blank day.
- **Live-play note.** The board itself keeps updating live (it's a live app); the arrows stay
  pinned to the last completed game day, disambiguated by the card's "Desde [data]" label. In
  practice they diverge only during the ~evening live window — the rest of the day `rank@B` equals
  `rank@now`, so board and arrows agree.

---

## Deriving historical standings (no storage)

We already reconstruct point history for the line chart (`buildChart`, `index.html:355`). The same
trick gives ranks at any instant: count only what had happened by the cutoff.

```js
// Standings as they stood at `cutoff` (ms). Counts matches finished with kickoff < cutoff,
// and podium points from the tournament state as of that cutoff.
function standingsAsOf(cutoff) {
  const ts = computeActualTournamentState(cutoff);   // ← asOf param, see dependency below
  return state.players.map(p => {
    let total = 0, exacts = 0;
    state.matches.forEach(m => {
      if (!isFinal(m) || kickoffMs(m) >= cutoff) return;
      const pred = state.allPreds[p.id]?.[m.id];
      const pts = calcPts(pred, m);
      if (pts !== null) { total += pts; if (isExact(pred, m)) exacts++; }
    });
    const pod = state.allPodiums[p.id];
    const podiumArr = pod ? [pod.first_place, pod.second_place, pod.third_place] : ["", "", ""];
    const podiumPts = calcPodiumPts(podiumArr, ts);
    if (podiumPts !== null) total += podiumPts;
    return { id: p.id, is_observer: p.is_observer, total, exacts };
  });
}
```

Rank assignment reuses the live leaderboard's order — `total` asc, `exacts` desc — applied within
each pool (non-observers ranked together; observers ranked within their own section). A helper
`boardAsOf(cutoff)` returns, per pool, an array carrying `{ id, rank, total, exacts, dinnerHalf }`,
where `dinnerHalf` reuses the existing `T = Math.floor(N/2)` split
(`_archive/leaderboard-v0-dinner-split.md`). Arrows and every fun fact derive from
`boardAsOf(A)` vs `boardAsOf(B)`.

### Dependency on spec #3

`standingsAsOf` needs tournament state *as of a cutoff*. Extend
`podium-elimination-and-scoring.md`'s `computeActualTournamentState` to take an optional
`asOf = Infinity`, filtering every match selection by `kickoffMs(m) < asOf` (so group-stage
completion, R32 qualification, and knockout losers are all evaluated as of the cutoff). Current
state stays `computeActualTournamentState()`; history is `computeActualTournamentState(cutoff)`.
**Build #3 first.**

---

## Position-change display (arrows)

In the rank column of each leaderboard row (`index.html:1472-1475`, the 28px cell that already
holds the rank number + 🔒), add a small delta indicator beneath the number:

| Change | Indicator |
|--------|-----------|
| Moved up `n` | `▲n` green (`#10b981`) |
| Moved down `n` | `▼n` red (`#ef4444`) |
| No change | `–` muted |
| No baseline (joined after `A`, or first game day) | nothing |

`delta = rankAtA − rankAtB` (positive = climbed). Applied in both the main list and the
Observadores section, each within its own ranking. Exact ties don't create phantom arrows: the
sort key (`total`, then `exacts`, then stable player order) is deterministic across both cutoffs.

**Optional motion.** When rows reorder between renders, a FLIP slide animation makes the movement
feel alive. Nice-to-have; arrows are the 80/20. Out of the core cut if it bloats the single file.

---

## Fun-facts card — "Desde [data]"

A card above the leaderboard list (below the chart), shown when `lastCompletedGameDay` exists. The
heading names the window, e.g. **"Desde a jornada de 27 jun"**. Facts are generated from the
`A`→`B` diff plus the matches in `[A, B)`, then **prioritised and capped at ~5** so it stays a
punchy highlight reel, not a log.

Priority order and templates (all derived; Portuguese, real names):

1. 👑 **Lead change** — rank-1 differs at `B` vs `A`: *"Novo líder: Rita"*
2. 🚀 **Biggest climber** / 😬 **biggest faller** — max `|delta|`: *"Pedro subiu 4 lugares"*,
   *"Ana caiu 3"*
3. ☠️ **Podium hit** (KO phase) — a team newly in `ts(B).eliminated` but not `ts(A).eliminated`
   that sits in someone's `podiumArr`: *"O pódio de Ana levou um golpe — Brasil eliminado (+20)"*
4. 🔁 **Overtakes** — pairs where `x` was below `y` at `A` and above at `B`; show the most
   significant 1–2: *"Miguel ultrapassou Pedro"*
5. 🎯 **Exact calls** — `isExact` on a match in `[A, B)`: *"Pedro acertou o resultado: Brasil 2-1"*
6. 🍽️ **Dinner-zone crossing** — `dinnerHalf` flipped top↔bottom between `A` and `B`:
   *"Pedro saiu da zona que paga o jantar"* / *"Ana entrou na zona que paga"*

If fewer than a couple of facts fire (quiet day), show what there is; if none, hide the card. The
"pops up" feel is a subtle entrance animation on the card; no dismiss needed (it rerolls each game
day).

---

## Edge cases

- **First game day** — no prior window, so `lastCompletedGameDay` is null: no arrows, no card.
- **Late-joining player** — present at `B` but not `A` (no baseline rank): no arrow, and they
  can't be a "climber/faller." (v0 players are seeded up front, so this is mostly theoretical.)
- **Postponed/odd kickoff** — a match is attributed to the game day of its (UTC) kickoff; a
  postponed match shifts to its new kickoff's day, which is correct.
- **Observers** — get arrows within their own section only; never appear in dinner-zone facts (not
  in the pool), consistent with the rest of the app.

---

## Implementation notes

### Files touched

Only `index.html` (plus the `asOf` extension to `computeActualTournamentState` from spec #3). No
DB, no Edge Function.

### Where the logic lives

- **Helpers** — `gameDayStart`, `kickoffMs`, `lastCompletedGameDay`, `standingsAsOf`,
  `boardAsOf`, and a `gameDayFacts(A, B)` generator, near `computeActualTournamentState`
  (`index.html:718`).
- **Arrows** — in `renderLbRow` (`index.html:1458`), rank cell at `index.html:1472-1475`; look up
  the row's delta from a precomputed `id → delta` map.
- **Card** — rendered in `renderLeaderboard` between the chart block and the list
  (`index.html:1543`), from `gameDayFacts`.
- **Compute once per render** — call `lastCompletedGameDay(Date.now())` once in
  `renderLeaderboard`, derive `boardAsOf(A)` / `boardAsOf(B)`, pass deltas + facts down.

### Order of work

1. (Spec #3) add `asOf` to `computeActualTournamentState`.
2. Helpers: `gameDayStart` / `kickoffMs` / `lastCompletedGameDay` / `standingsAsOf` / `boardAsOf`.
3. Per-row arrows from the `A`→`B` delta map.
4. `gameDayFacts` generator + the "Desde [data]" card.
5. (Optional) FLIP row-reorder animation.

---

## Out of scope

- **Per-viewer "since *you* last looked"** — deliberately rejected: a personal baseline fragments
  the shared story that makes mock/praise work. Everyone sees the same game-day movement.
- **A snapshot/history table** — unnecessary; rankings are derived. (If we ever want an exact
  audit trail of standings over time, revisit then.)
- **Point deltas** — the ask is *position* changes; points already live in the list and charts.
- **Live, per-match arrow churn** — frozen to completed game days by design.
- **v1 (`goalgut/`).** The game-day rhythm and dinner-zone facts are v0-flavoured.

## Reversibility

Pure `index.html` render addition reading existing data; nothing persists. The only shared edit is
the `asOf` parameter on `computeActualTournamentState` (default `Infinity` = today's behaviour).
Reverting is removing the helpers, the arrows, and the card.

## Testing

No runtime gate hides this (it works from the second game day onward), so it *can* be exercised as
soon as there are ≥2 game days of results — but the richest cases (podium hits, dinner crossings)
need knockout/late-stage data, which is gated like the sibling specs. Verify by hand against a
seeded fixture set:

- ranks at `A` vs `B` match a manual recompute counting only `kickoff < cutoff` matches;
- a player who gained points overnight shows the right ▲/▼; a flat player shows `–`;
- empty (rest) days are skipped — the window rolls back to the last day with matches;
- during a live evening match, arrows stay pinned to last night and the card label still reads the
  previous game day;
- each fun-fact fires on a constructed scenario (lead change, biggest mover, podium elimination,
  overtake, exact, dinner crossing) and the card caps at ~5 in priority order.
