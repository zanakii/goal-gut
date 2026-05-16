# Spec: Predictions Reorganised by Group with Live Standings

## Goal

Reorganise the Predictions tab from a flat by-date list into group-by-group sections, each
showing a live mini standings table that updates as the player edits scores. Desktop users get
a side-by-side layout (matches | standings). Mobile users get a stacked layout.

---

## Current layout

Matches are sorted by kickoff date and grouped under date headers. No standings are shown. The
`change` event on score inputs mutates `state.editPreds` but does **not** call `render()`, so
nothing updates visually until the next user action that triggers a render.

---

## New layout — per group section

Replace the by-date grouping with by-group sections, ordered A → L.

Each section contains:

```
┌─────────────────────────────────────────────────────────┐
│ GRUPO A                                                  │
├──────────────────────────────┬──────────────────────────┤  ← desktop only
│  Match cards (with inputs)   │  Mini standings table    │
│  Portugal  [2] - [0]  Ghana  │  🟢 Portugal   6pt +6   │
│  Uruguai   [1] - [1]  Coreia │  🟢 Uruguai    4pt +2   │
│  Portugal  [1] - [0]  Coreia │     Coreia     1pt -3   │
│  ...                         │     Ghana      0pt -5   │
└──────────────────────────────┴──────────────────────────┘
```

On mobile (< 640px): standings table appears below the match cards for that group, not beside
them.

---

## Responsive CSS

Each group section uses CSS Grid:

```css
/* default: single column (mobile) */
.group-section { display: grid; grid-template-columns: 1fr; gap: 12px; }
.group-standings { /* renders below matches */ }

/* desktop: two columns */
@media (min-width: 640px) {
  .group-section { grid-template-columns: 1fr 200px; align-items: start; }
  .group-standings { position: sticky; top: 80px; }  /* stays in view while scrolling matches */
}
```

The standings column is `sticky` on desktop so it stays visible as the player scrolls through
a long group's matches.

---

## Live standings update

Currently `change` handlers on score inputs mutate state but skip `render()`. Add `render()`
after the mutation so standings recalculate on every blur:

```js
inpA.addEventListener("change", () => {
  if (!locked) {
    const ep = { ...state.editPreds };
    ep[m.id] = { ...ep[m.id], score_a: parseInt(inpA.value) || 0 };
    state.editPreds = ep;
    state.predictionsEdited = true;
    render();   // ← add this
  }
});
```

`change` fires on blur, not on every keystroke, so re-rendering after the user leaves the field
is safe — focus has already moved on.

---

## Mini standings table

Rendered once per group using `computePredictedStandings(state.editPreds, state.matches)` (the
same function used in the bracket tab). Shows all 4 teams with: position indicator, flag + name,
points, and goal difference.

```
🟢  🇵🇹 Portugal    6pt  +6
🟢  🇺🇾 Uruguai     4pt  +2
    🇰🇷 Coreia      1pt  -3
    🇬🇭 Ghana       0pt  -5
```

`🟢` marks the top 2 (qualifiers). No interaction — read-only.

If all predictions for the group are 0-0 (default), show the table with all teams at 0pt/0gd
and a subtle note: "Edita os resultados para ver a classificação".

---

## Grouping logic

Replace the by-date sort with by-group:

```js
const GROUP_ORDER = ['A','B','C','D','E','F','G','H','I','J','K','L'];
const groupMatches = {};
GROUP_ORDER.forEach(g => { groupMatches[g] = []; });
state.matches
  .filter(m => m.group_letter && m.group_letter.length === 1)
  .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))   // within-group: chronological
  .forEach(m => { if (groupMatches[m.group_letter]) groupMatches[m.group_letter].push(m); });
```

Each match card within a group still shows its kickoff date + time, preserving temporal context.
The `Grupo X ·` prefix on each card can be dropped since the group header makes it redundant.

---

## Knockout matches

Currently no knockout matches exist in the DB (WC hasn't started). When they are seeded after
the group stage, they will have multi-character `group_letter` values (R32, R16, QF, etc.) and
will be excluded from the by-group sections above. Add a separate "Fase Eliminatória" section
at the bottom of the predictions tab for these — or remove them from this tab entirely since the
bracket tab already handles knockout predictions. Decision deferred until group stage ends.

---

## Interaction with warn-unsaved spec

No change needed. The warn-unsaved guard triggers on tab navigation (`navigateTo()`) and
`beforeunload`. Scrolling between group sections within the predictions tab is not a navigation
event, so no guard is needed between groups.

---

## What doesn't change

- Excel import/export buttons remain at the top
- Podium card remains below the import buttons
- Deadline banner and sticky submit button remain at the bottom
- `predictionsEdited` flag behaviour unchanged

---

## Files to modify

- `index.html` — `renderPredictions()`: replace by-date grouping with by-group sections,
  add mini standings render per group, add `render()` to change handlers, add CSS for
  `.group-section` and `.group-standings` responsive grid
- No Edge Function changes, no DB changes
