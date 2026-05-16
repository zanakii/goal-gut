# Spec: Excel Import/Export Improvements

Three bundled changes to `generateTemplate()`, `importExcel()`, and the surrounding UI.

---

## Issue 1 — Pre-fill template with existing predictions

### Problem
`generateTemplate()` always writes empty strings for score columns regardless of whether the
player has already submitted predictions.

### Fix
Use `state.editPreds[m.id]` when populating the score columns. If a prediction exists, fill it
in; if not (shouldn't happen after first submission, but defensively), leave blank.

```js
// line 1165 — before
sorted.forEach(m => rows.push([m.group_letter, fmtDate(m.kickoff), m.team_a, "", "", m.team_b, m.id]));

// after
sorted.forEach(m => {
  const pred = state.editPreds[m.id];
  const sa = pred?.score_a ?? "";
  const sb = pred?.score_b ?? "";
  rows.push([m.group_letter, fmtDate(m.kickoff), m.team_a, sa, sb, m.team_b, m.id]);
});
```

No changes to `importExcel()` — it already reads from column indices and handles pre-filled
files correctly.

---

## Issue 2 — Receipt download after submission

### What it is
A filled Excel file the player can download as confirmation of their saved predictions.
Contains all predicted scores and the podium (if bracket was submitted).
Includes submission date in both the filename and the file content.

### When it appears
Only once `state.submitted === true`. Add a "⬇ Recibo" button to the import/export row in
the predictions tab (sits alongside the existing template and import buttons). It is **not**
shown pre-submission — an unfiled receipt would misrepresent unsaved predictions.

### State addition
```js
submittedAt: null,   // Date object, set when submitPredictions() succeeds
```

Set in `submitPredictions()` success path, after `loadData(true)`:
```js
state.submittedAt = new Date();
```

Reset to `null` on `switchPlayer()` and `loadData()` (since submitted status is re-evaluated).
Restore on load: if `submitted === true` and `submittedAt === null`, set to a sentinel like
`new Date(0)` — the receipt will show "Data desconhecida" for sessions that pre-date this field.

### Receipt file structure

**Sheet 1 — "Prognósticos"** (same layout as template):

| Grupo | Data | Equipa A | Marcador A | Marcador B | Equipa B | id (hidden) |
|-------|------|----------|------------|------------|----------|-------------|

All score columns pre-filled from `state.editPreds`. Top row (before the header) includes a
metadata row:

```
Recibo de Prognósticos — [player name] — Submetido em [DD/MM/YYYY HH:MM]
```

This row spans the full width and is styled bold if the XLSX library supports it (use
`XLSX.utils.aoa_to_sheet` with a leading row for metadata, then shift data rows down by 1).

**Sheet 2 — "Pódio"**:

If `state.hasBracket` and podium teams are set:
```
Posição     Equipa
Campeão     [team]
2º Lugar    [team]
3º Lugar    [team]
```

If bracket not submitted:
```
⚠ Fase Final não submetida — acede ao separador Fase Final para completar o pódio.
```

### Filename
```
recibo_[player_name]_[YYYY-MM-DD].xlsx
```
e.g. `recibo_Pedro_2026-06-08.xlsx`

### New function `generateReceipt()`
Mirrors `generateTemplate()` but with:
- Metadata row at top
- All scores pre-filled
- Podium as a second sheet
- Different filename

```js
function generateReceipt() {
  const sorted = [...state.matches].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  const submittedLabel = state.submittedAt && state.submittedAt.getTime() > 0
    ? fmtDate(state.submittedAt.toISOString()) + " " + fmtTime(state.submittedAt.toISOString())
    : "Data desconhecida";

  // Sheet 1 — predictions
  const meta = [[`Recibo de Prognósticos — ${state.currentPlayer?.name || ""} — Submetido em ${submittedLabel}`]];
  const header = [["Grupo", "Data", "Equipa A", "Marcador A", "Marcador B", "Equipa B", "id"]];
  const dataRows = sorted.map(m => {
    const pred = state.editPreds[m.id];
    return [m.group_letter, fmtDate(m.kickoff), m.team_a, pred?.score_a ?? "", pred?.score_b ?? "", m.team_b, m.id];
  });
  const ws1 = XLSX.utils.aoa_to_sheet([...meta, ...header, ...dataRows]);
  ws1["!cols"] = [{ wch: 6 }, { wch: 16 }, { wch: 18 }, { wch: 11 }, { wch: 11 }, { wch: 18 }, { hidden: true }];

  // Sheet 2 — podium
  const [fp, sp, tp] = derivePodiumFromBracket(state.editBracket);
  const podiumRows = state.hasBracket && (fp || sp || tp)
    ? [["Posição", "Equipa"], ["Campeão", fp || "—"], ["2º Lugar", sp || "—"], ["3º Lugar", tp || "—"]]
    : [["⚠ Fase Final não submetida — acede ao separador Fase Final para completar o pódio."]];
  const ws2 = XLSX.utils.aoa_to_sheet(podiumRows);
  ws2["!cols"] = [{ wch: 12 }, { wch: 20 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, "Prognósticos");
  XLSX.utils.book_append_sheet(wb, ws2, "Pódio");

  const dateStr = (state.submittedAt || new Date()).toISOString().slice(0, 10);
  XLSX.writeFile(wb, `recibo_${(state.currentPlayer?.name || "jogador").replace(/\s+/g, "_")}_${dateStr}.xlsx`);
}
```

---

## Issue 3 — Hide the ID column

### Problem
The ID column (column G, index 6) is editable by accident, breaking the import logic which
relies on it to match rows to matches.

### Fix
Set `hidden: true` on the ID column in `"!cols"`. SheetJS respects this flag and Excel/Google
Sheets both honour it — the column is present in the data but invisible in the UI.

```js
// generateTemplate() — line 1167
ws["!cols"] = [
  { wch: 6 }, { wch: 16 }, { wch: 18 }, { wch: 11 }, { wch: 11 }, { wch: 18 },
  { hidden: true }   // ID column — hidden, do not edit
];
```

Apply the same `{ hidden: true }` to the `ws1["!cols"]` in `generateReceipt()` (already
included in the receipt function above).

No changes to `importExcel()` — it reads by column index regardless of visibility.

---

## UI changes in `renderPredictions()`

Replace the current two-button import/export row with a three-button row when submitted:

```
[ ⬇ Template Excel ]  [ ⬇ Recibo ]  [ ⬆ Importar Excel ]
```

When not yet submitted, keep the current two-button layout (no receipt button).

---

## Files to modify

- `index.html`:
  - `generateTemplate()` — pre-fill scores, hide ID column
  - Add `generateReceipt()` function
  - `submitPredictions()` — set `state.submittedAt = new Date()` on success
  - `switchPlayer()` and `loadData()` — reset / restore `submittedAt`
  - `renderPredictions()` — add receipt button when `state.submitted`
  - Add `submittedAt: null` to initial state
- No Edge Function changes, no DB changes
