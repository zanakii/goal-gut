# Spec: Excel Audit Export (v0)

## Problem

Once the submission deadline passes and matches start playing out, players naturally want to
**audit the leaderboard manually** — particularly older friends in the group who default to
pen-and-paper or spreadsheet tracking. The app exposes the current state, but it doesn't let
anyone independently verify "for match X, what did each of us pick, what was the actual
result, and how were the points distributed?" without clicking through each player one by
one.

We want a single downloadable Excel file containing every group-stage match, the known
result (blank if not played), every player's score prediction, and the attributed points
per game per player (blank when no result is known yet). The file should also include the
podium predictions and their attributed points for the same audit purpose.

The goal is **manual tracking + a sanity check on the app's scoring in its first rodeo**.

## Goal

- Add a new "⬇ Auditoria" button that downloads the audit file.
- The button appears in the header of **both** the Matches tab and the Leaderboard tab.
- The button is **only visible post-submission-deadline** (same gate that flips other
  predictions-visibility behaviour).
- The file is a single sheet, one row per group-stage match, with three column blocks:
  match identity + actual result, then all predictions, then all attributed points.
- A second section below the matches contains the podium predictions and attributed points
  per slot.
- All players are included — regulars **and** observers. Observers are flagged in column
  headers with the 👀 prefix to match the in-app convention.

**Scope: v0 only.** This is a manual-audit affordance for the friend group. The public
edition will have its own export story.

---

## User-facing behaviour

### Visibility gate

The Auditoria button appears only when `now >= state.submissionDeadline`. Same gate that
already controls post-deadline predictions reveal. Before that point: button hidden, no
download possible.

(Pre-deadline this file would either leak everyone's predictions or be empty — either way
worthless. Post-deadline, predictions are public anyway, so no privacy concern.)

### Where the button lives

Two locations, identical behaviour:

- **Matches tab** — header row, alongside the existing tab title. Right-aligned.
- **Leaderboard tab** — header row, alongside the chart title or the existing legend
  caption. Right-aligned.

Both invoke the same `generateAudit()` function. No state difference between the two — the
file content is identical regardless of which button was clicked.

### Button label and icon

`⬇ Auditoria` — matches the existing iconography of `⬇ Template Excel` / `⬇ Recibo` in the
predictions tab. Use the same green-tinted style.

### Filename

```
goalgut_resultados_YYYY-MM-DD.xlsx
```

`YYYY-MM-DD` = the date the file was generated (i.e. `new Date().toISOString().slice(0,10)`).

---

## File structure

### Single sheet — `Resultados`

Two stacked sections separated by a blank row.

#### Section 1 — Match rows

Header row (row 1):

```
| Grupo | Data | Equipa A | Resultado A | Resultado B | Equipa B | <PRED block> | <PTS block> |
```

`<PRED block>` repeats per player, in alphabetical order by slug (see "Player ordering"
below):

```
| <SLUG> A | <SLUG> B |
```

For an observer named `Carla` with slug `CAR`, the column headers become `👀 CAR A` /
`👀 CAR B`. Same convention everywhere the slug appears.

`<PTS block>` repeats per player, in the same order:

```
| <SLUG> Pontos |
```

#### Data rows

One row per group-stage match (72 rows). Order: ascending by `kickoff` (same as
`generateTemplate()` / `generateReceipt()`).

- `Grupo`, `Data`, `Equipa A`, `Equipa B`: same as today's template.
- `Resultado A`, `Resultado B`: from `m.score_a` / `m.score_b`. **Blank** when null.
- Per-player `A` / `B` columns: from `state.allPreds[player_id]?.[m.id]?.score_a` /
  `.score_b`. **Blank** if the player didn't predict that match.
- Per-player `Pontos` column: `calcPts(pred, m)` if `m.score_a !== null`, else **blank**.
  (Reuses the same scoring function the leaderboard uses — single source of truth.)

#### Group-stage filtering

The audit covers group-stage matches only. Knockout fixtures are skipped per agreement.

Filter rule: include matches where `m.group_letter != null`. This is the same heuristic the
existing template uses — verify in `seed-knockout.js` that KO matches are inserted with
`group_letter = null`, and adjust if not.

#### Blank separator

Two blank rows between Section 1 and Section 2 (one for breathing room, one as a visual
anchor for spreadsheet readers).

#### Section 2 — Podium rows

Header row:

```
| Posição | Equipa Real | <PRED block> | <PTS block> |
```

- `Posição`: `Campeão`, `2º Lugar`, `3º Lugar`.
- `Equipa Real`: actual team in that slot — **blank** until the tournament resolves that
  position. Sources:
  - `Campeão`: winner of the final (when final is `isFinal(m)` with a non-draw resolution).
  - `2º Lugar`: loser of the final (same condition).
  - `3º Lugar`: winner of the third-place playoff (when that match is `isFinal(m)`).
- `<PRED block>` per player: a single column `<SLUG>` containing the team they picked for
  that slot (from `state.allPodiums[player_id]`). Blank if no podium submitted.
- `<PTS block>` per player: a single column `<SLUG> Pontos` containing the points attributed
  for that slot, by the same logic `calcPodiumPts` uses (0 for exact, +10 for right team in
  wrong slot, +20 for missing/eliminated/wrong). Blank when `tournamentState` doesn't yet
  allow scoring for that slot (i.e. pre-`groupStageComplete`).

#### Required refactor — per-slot podium scoring

`calcPodiumPts` currently returns the aggregate of all three slots. For per-slot output in
the audit file, extract a helper:

```js
function calcPodiumSlotPts(slotIndex, predTeam, tournamentState) {
  // 0 / 10 / 20 logic for a single slot; returns null when not yet scorable
}
```

And rewrite `calcPodiumPts` to sum three calls. Zero behaviour change for the leaderboard
(verify against current totals). The audit export then calls the per-slot helper directly.

This is a small refactor and worth doing — the audit is exactly the use case the spec
co-author warned about in CLAUDE.md ("Do not duplicate this logic elsewhere"), and a single
per-slot helper preserves that.

### Player ordering

Alphabetical by `slug`, ascending. All players in one block — observers are not separated
into a different column region. The 👀 prefix on observer column headers is the only
distinguishing mark in the file.

(Rationale: this is an audit file. A reader sweeping left-to-right benefits from predictable
alphabetical order more than from a regular/observer split. The observer status is
preserved via the column header prefix for anyone who needs it.)

---

## Data model

### New column — `players.slug`

```sql
alter table players
  add column slug text;

-- intentionally nullable; admin populates manually per player after this migration.
-- the export gracefully handles nulls (see below).
```

- **Nullable**. Pedro will backfill slugs manually after the migration. No default value —
  forcing a default like first-3-letters-of-name risks silent collisions (`Pedro Miguel`
  and `Pedro Castro` both → `PED`).
- **No uniqueness constraint at the DB level**. Avoid blocking inserts; a slug collision is
  a UX issue surfaced in the export (two columns with the same header), not a data
  integrity issue. The app's data is keyed by `player_id`.
- **Frontend handling for missing slugs**: when a player has `slug = null` at audit time,
  fall back to `p.name.replace(/\s+/g, "_").slice(0, 8).toUpperCase()` — generates a
  deterministic, ugly-but-readable placeholder so the file is never broken. Tooltip / no UI
  warning needed; Pedro will fill the real slug in the DB.

### No other schema changes

- `predictions`, `podium_predictions`, `matches`, `tournament_config` — unchanged.
- No new Edge Functions. The export is built entirely from state already loaded on the
  frontend.

---

## Implementation notes

### Files touched

- `index.html`:
  - `generateAudit()` — new function. Mirrors the structure of `generateTemplate()` but
    builds the wider matrix and the podium section.
  - `calcPodiumSlotPts(slotIndex, predTeam, tournamentState)` — new helper. Refactor
    `calcPodiumPts` to use it.
  - Matches-tab header (~`index.html:1180s` block) — add the `⬇ Auditoria` button.
  - Leaderboard-tab header (~`index.html:1283` block) — add the same button.
  - Visibility helper: gate both buttons behind `state.deadlinePassed` (same flag used
    elsewhere).
- One SQL migration in Supabase: `alter table players add column slug text;`. Not tracked
  in repo, consistent with other schema changes.
- No Edge Function changes. No GitHub Actions changes.

### Sketch

```js
function generateAudit() {
  const orderedPlayers = [...state.players].sort((a, b) =>
    slugOf(a).localeCompare(slugOf(b))
  );
  const groupMatches = [...state.matches]
    .filter(m => m.group_letter != null)
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));

  // header row
  const baseHeader = ["Grupo", "Data", "Equipa A", "Resultado A", "Resultado B", "Equipa B"];
  const predHeader = orderedPlayers.flatMap(p => [`${slugLabel(p)} A`, `${slugLabel(p)} B`]);
  const ptsHeader = orderedPlayers.map(p => `${slugLabel(p)} Pontos`);
  const header = [...baseHeader, ...predHeader, ...ptsHeader];

  // match rows
  const matchRows = groupMatches.map(m => {
    const result = [m.group_letter, fmtDate(m.kickoff), m.team_a,
                    m.score_a ?? "", m.score_b ?? "", m.team_b];
    const preds = orderedPlayers.flatMap(p => {
      const pred = state.allPreds[p.id]?.[m.id];
      return [pred?.score_a ?? "", pred?.score_b ?? ""];
    });
    const pts = orderedPlayers.map(p => {
      const pred = state.allPreds[p.id]?.[m.id];
      return m.score_a !== null && pred ? calcPts(pred, m) : "";
    });
    return [...result, ...preds, ...pts];
  });

  // podium section
  const podiumBase = ["Posição", "Equipa Real"];
  const podiumPredHeader = orderedPlayers.map(p => slugLabel(p));
  const podiumPtsHeader = orderedPlayers.map(p => `${slugLabel(p)} Pontos`);
  const podiumHeader = [...podiumBase, ...podiumPredHeader, ...podiumPtsHeader];

  const slotLabels = ["Campeão", "2º Lugar", "3º Lugar"];
  const ts = tournamentState();   // wherever this is computed today
  const podiumRows = slotLabels.map((label, slotIdx) => {
    const actual = resolveActualPodiumSlot(slotIdx, state.matches) ?? "";
    const picks = orderedPlayers.map(p => state.allPodiums[p.id]?.[slotIdx] ?? "");
    const slotPts = orderedPlayers.map(p => {
      const team = state.allPodiums[p.id]?.[slotIdx];
      return calcPodiumSlotPts(slotIdx, team, ts) ?? "";
    });
    return [label, actual, ...picks, ...slotPts];
  });

  const aoa = [
    header, ...matchRows,
    [], [],
    podiumHeader, ...podiumRows
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // optional: column widths
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Resultados");
  XLSX.writeFile(wb, `goalgut_resultados_${new Date().toISOString().slice(0,10)}.xlsx`);
}

function slugOf(p) { return p.slug || p.name.replace(/\s+/g, "_").slice(0, 8).toUpperCase(); }
function slugLabel(p) { return p.is_observer ? `👀 ${slugOf(p)}` : slugOf(p); }
```

`resolveActualPodiumSlot(slotIdx, matches)` — small helper that finds the final and
third-place-playoff matches (by status `isFinal(m)` + knockout round), and returns the
winning/losing team for each slot. Returns `null` if not yet resolvable. The exact rules
depend on how the knockout schema is laid out — verify before implementing.

### Order of work

1. SQL migration in Supabase: add `players.slug` column.
2. Refactor `calcPodiumPts` to use `calcPodiumSlotPts`; verify totals unchanged.
3. Write `generateAudit()` and `slugOf` / `slugLabel` helpers.
4. Add `⬇ Auditoria` buttons to Matches and Leaderboard tab headers, behind the deadline
   gate.
5. Pedro populates real slugs in the DB.
6. Manual smoke test post-deadline: open the file, eyeball Section 1 column count, spot-check
   a couple of point calcs against the leaderboard.

---

## Out of scope

- Summary / totals row at the bottom. Pedro: "If they want a sum, they have the app. This
  is more audit-driven."
- Knockout-match rows. Group-stage only.
- A receipt-style metadata row at the top (timestamp, who downloaded). Filename carries the
  date; no need to clutter the sheet.
- Per-player podium sums or grand totals.
- CSV / PDF formats. Excel only.
- Edge Function backend export — entirely client-side, reading from already-loaded state.
- Carrying this to v1 (`goalgut/`). The public edition will design its own export.

## Open questions

None — all resolved during specing.
