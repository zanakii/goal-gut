# Spec: Leaderboard — Dinner Split & Position Ranges (v0 only)

## Problem

The leaderboard today shows all players ranked by total penalty points, with a generic Top 3
highlight and no visual cue about the **actual stakes** of the pool — the losing half pays the
winning half's dinner. The leaderboard is also visible immediately, even before any match has
kicked off, which is meaningless (everyone is at 0).

We also want to convey, once the group stage ends, how much room each player has left to
move — i.e., the range of final positions they can still achieve, and whether their fate in
the winners' / losers' half is already mathematically settled.

## Goal

- Gate the leaderboard tab so it only appears once the tournament has actually kicked off.
- Layer green/red shading on top of the existing rank list so the dinner split is obvious at
  a glance: top half = green ("eats"), bottom half = red ("pays").
- After the group stage ends, show each player's possible final-position range, and intensify
  the shading for players who have **secured** their place in the winners' half ("locked
  green") or who **can no longer reach it** ("locked red").

**Scope: v0 only.** This is themed around the friend-group dinner stakes and should not be
ported to the public edition (`goalgut/` sibling).

---

## User-facing behaviour

### Visibility gate

| State | Leaderboard tab |
|-------|-----------------|
| Before first match kickoff | Hidden from nav |
| First match kicked off or any match has a score | Visible |

"Kicked off" = at least one match satisfies `new Date(m.kickoff) <= now` **or**
`m.score_a !== null` **or** `isLive(m)` / `isFinal(m)`.

Other tabs (Matches, Predictions, Bracket) are unaffected.

### Dinner split — cutoff math

Let `N` = number of players, `T` = size of the **winners' half** (the half that eats).

```
T = Math.floor(N / 2)
```

- Even N (e.g. 10): T = 5. Top 5 win, bottom 5 pay.
- Odd N (e.g. 11): T = 5. Top 5 win, **bottom 6 pay** — the larger half pays, as agreed.

Ranks `1..T` = winners' half. Ranks `T+1..N` = losers' half.

### Ranking & tiebreaks

Primary sort: `total` ascending (lower is better — golf scoring).

Tiebreak: **number of exact predictions descending** (more exacts = better rank). Already
computed as `p.exacts` in `renderLeaderboard()`.

If two players are still tied after the tiebreak and they straddle the cutoff line, they
share the same neutral shading (see "Tied across the cutoff" below).

### Shading — pre-group-stage-end

Once the leaderboard is visible but the group stage has not yet finished, apply a single layer
of shading based on **current rank**:

- Rank `1..T` → soft green background (`rgba(16, 185, 129, 0.08)` / green border accent on
  the left edge).
- Rank `T+1..N` → soft red background (`rgba(239, 68, 68, 0.08)` / red border accent).
- Top 3 medal styling (existing) sits on top — gold glow / medal emojis stay, layered over
  the green half.

### Shading — post-group-stage (after last group match goes final)

Trigger: `tournamentState.groupStageComplete === true` (already computed; this is the same
flag that gates `calcPodiumPts`).

From this point on, the group-stage total per player is **fixed**. Only podium points can
still change, and only as teams in players' podium predictions get eliminated through the
knockouts.

(Bracket picks themselves do not score — they are the UI that feeds the podium prediction.
The leaderboard sums `calcPts` over matches + `calcPodiumPts` only. See `renderLeaderboard()`
in `index.html`.)

For each player, compute a **possible final-rank range** `[bestRank, worstRank]` (see
"Algorithm" below) and apply:

| Condition | Treatment |
|-----------|-----------|
| `worstRank ≤ T` — **locked into winners' half** | Strong green: solid green background (`rgba(16, 185, 129, 0.18)`), green left border (`3px solid #10b981`), 🔒 padlock icon next to rank |
| `bestRank > T` — **locked out of winners' half** | Strong red: solid red background (`rgba(239, 68, 68, 0.18)`), red left border (`3px solid #ef4444`), 🔒 padlock icon next to rank |
| Otherwise, current rank ≤ T | Soft green (same as pre-group-stage-end) |
| Otherwise, current rank > T | Soft red (same as pre-group-stage-end) |

Recompute the range after every knockout match that finalises (`isFinal(m)` flips to true for
a knockout). The trigger naturally happens via `render()` after `fetch-results` writes a new
score.

### Tied across the cutoff

If two or more players have identical `total` AND identical `exacts` AND their ranks span the
cutoff line (e.g. one is rank T, another rank T+1), shade all tied rows **neutral grey**
(`rgba(255,255,255,0.04)`) with a dashed left border. Caption tooltip on hover/tap:
"Empate na linha de corte — desempate por jogos exactos."

This avoids implying a placement that doesn't exist yet.

This rule applies **any time the leaderboard is visible** — both during the group stage and
after. The leaderboard should always represent transient ties on the cutoff line honestly,
not just post-group-stage. (Post-group-stage, locked-green / locked-red shading takes
precedence over the neutral grey, since a locked classification by definition resolves the
cutoff for that player regardless of the tie.)

### Possible-positions display

When `groupStageComplete`, show a small caption below the player's name, between the existing
"X jogos · Y exactos" line and the score column:

```
Possível: #2 – #4
```

- Always show the range, including for locked players. The lock conveys "safe half"; the
  range conveys "where in the half". They're complementary.
- If `bestRank === worstRank`, show `Posição final: #3` instead of a range (this happens when
  the player has no alive podium picks left — fully resolved).
- Hide entirely before `groupStageComplete`.

### Top 3 highlight (unchanged behaviour, layered)

The existing `.top` class (rank < 3) still applies its gold styling. Because Top 3 are by
definition in the winners' half (T ≥ 3 for any realistic N ≥ 5), green shading sits
underneath the gold treatment. No conflict expected. Locked-green styling also composes:
a Top-3 player who is locked into the winners' half can show medal + gold + locked-green
border without visual collision.

---

## Algorithm — possible-position range

Inputs (post-group-stage):
- For each player `p`: `groupTotal` (fixed), `exacts` (fixed), `podiumArr` (their 3 picks).
- `tournamentState.eliminated`: Set of teams already eliminated from the tournament.
- `aliveTeams`: complement of `eliminated`, restricted to teams that started the knockouts.

**Step 1 — per-player podium-pts bounds.**

For each player `p`:

- `lockedPodiumPts` = sum over `p.podiumArr` of: `20` if the predicted team is in
  `eliminated` or empty/missing, else `0` (the "could still hit" bucket).
- `pendingPicks` = number of `p.podiumArr` slots whose predicted team is still alive.
- `minPodiumPts(p) = lockedPodiumPts + 0 * pendingPicks` → best case: every alive pick lands
  exactly on its predicted slot.
- `maxPodiumPts(p) = lockedPodiumPts + 20 * pendingPicks` → worst case: every alive pick
  finishes off the podium.

We deliberately compute these bounds **independently per player**, ignoring the constraint
that scenarios across players must be consistent (e.g. only one team can actually be
champion). This produces looser bounds but is what the user asked for: "could you still
escape" / "are you safe regardless." Cross-player consistency would tighten ranges but
massively complicate the algorithm without changing the locked/not-locked classification in
practice.

`minTotal(p) = groupTotal(p) + minPodiumPts(p)`
`maxTotal(p) = groupTotal(p) + maxPodiumPts(p)`

**Step 2 — per-player rank bounds.**

For each player `p`:

- `bestRank(p)` = 1 + count of other players `q` such that `maxTotal(q) < minTotal(p)`.
  (In `p`'s best case `p` is at `minTotal`, and only players whose worst-case total still
  beats `p`'s best can be strictly ahead.)
- `worstRank(p)` = N − count of other players `q` such that `minTotal(q) > maxTotal(p)`.
  (In `p`'s worst case `p` is at `maxTotal`, and only players whose best-case total still
  loses to `p`'s worst can be strictly behind.)

Tie handling: `<` and `>` are strict — players whose ranges overlap with `p`'s are treated as
"could go either way" and don't tighten the bound. This is the standard formulation and
behaves intuitively.

**Step 3 — classification.**

- Locked green: `worstRank(p) ≤ T`.
- Locked red: `bestRank(p) > T`.
- Otherwise: use current rank for soft-green / soft-red.

**Complexity.** O(N²) per recompute, N ≤ ~20 players in practice. Negligible. Recomputed on
each `render()` call when `groupStageComplete`.

---

## Implementation notes

### Files touched

Only `index.html`. No DB, no Edge Function, no backend changes.

### Where the logic lives

- **Visibility gate**: in the nav-tab list around `index.html:1126` — filter out the
  `leaderboard` entry when no match has started. Add a helper `tournamentStarted()`.
- **Cutoff & ranking**: extend the existing `lb` computation around `index.html:1287`.
  After the `.sort()`, append a pass that:
  - Re-sorts ties by `exacts` desc.
  - Computes `T = Math.floor(lb.length / 2)`.
  - When `groupStageComplete`, computes `minTotal`/`maxTotal` for every row, then
    `bestRank`/`worstRank`, then `locked` (one of `"green"`, `"red"`, `null`).
- **Row rendering**: add a `dinnerHalf` (`"top"` | `"bottom"` | `"neutral"`) and `locked`
  attribute on each row in `renderLeaderboard()`. Apply via existing inline-style pattern
  used for `isTop`. Add the "Possível: #X – #Y" line in the same block where `p.scored` and
  `p.exacts` are rendered (`index.html:1330`).
- **Padlock icon**: render before the rank number in the 28px-wide rank column
  (`index.html:1327`) when `locked` is set.

### CSS additions

Add a small block of class-based styles (instead of inline) to keep the row markup readable:

```css
.lb-row.half-top    { background: rgba(16, 185, 129, 0.08); border-left: 2px solid rgba(16,185,129,0.3); }
.lb-row.half-bottom { background: rgba(239, 68, 68, 0.08);  border-left: 2px solid rgba(239,68,68,0.3); }
.lb-row.half-neutral { background: rgba(255,255,255,0.04); border-left: 2px dashed rgba(255,255,255,0.2); }
.lb-row.locked-green { background: rgba(16, 185, 129, 0.18); border-left: 3px solid #10b981; }
.lb-row.locked-red   { background: rgba(239, 68, 68, 0.18);  border-left: 3px solid #ef4444; }
```

The `.top` class (Top 3) stays as-is and stacks on top.

### Legend / explanation for players

Add a one-line caption below the "Pontos Acumulados" chart header explaining the colour
scheme, only shown when `groupStageComplete`:

> Verde = metade vencedora · Vermelho = metade que paga o jantar · 🔒 = posição garantida

Before `groupStageComplete`, a shorter caption:

> 🟢 metade vencedora · 🔴 metade que paga o jantar

---

## Out of scope

- Settling actual money / dinner logistics — that's offline.
- Carrying any of this to v1 (`goalgut/`). The public edition has a different audience and
  no shared-dinner stake; the colour-coded "you pay" treatment would not translate.
- Showing the precise scenario (which knockout outcomes lead to a player's best vs worst
  case). Possible follow-up if anyone asks during the tournament.
- Cross-player constraint-aware range computation. Strictly tighter, strictly more complex,
  and unlikely to change a locked/not-locked classification.

## Open questions

- Wording of the dinner caption — Portuguese phrasing above is a draft. "Metade vencedora /
  metade que paga" reads well to me; happy to change to "Comem / Pagam" or similar if
  preferred.
- Should locked-green players also lose the expand-on-click affordance? No — keep it,
  exact-results breakdown is still interesting.
