# Spec: Bracket UX Improvements

Two issues bundled: back button destination and click-to-pick winners.

---

## Issue 1 — Back button and nav highlight (must-have)

### Problem
The bracket view's back button (`← Jogos`, line 759) sends the player back to the Matches tab.
The natural flow is Predictions → Bracket → Predictions. The nav bar also incorrectly highlights
"Jogos" when in bracket view (line 932: `state.view === "bracket" ? "matches" : state.view`).

### Fix

Two one-line changes:

```js
// Line 759 — back button
const backBtn = h("button", {
  onClick: () => setState({ view: "predictions" }),  // was "matches"
  ...
}, "← Prognósticos");                               // was "← Jogos"

// Line 932 — nav highlight
const activeId = state.view === "bracket" ? "predictions" : state.view;  // was "matches"
```

---

## Issue 2 — Click-to-pick winners (nice-to-have)

### Problem
Picking a match winner requires a 48-team dropdown, even when both teams are already resolved.
The team pills above the dropdown are already visually styled to show the picked winner but are
not interactive.

### Desired behaviour

| State | UI |
|-------|----|
| Both teams known | Clickable pills only — no dropdown |
| Teams not yet known (slot pending) | Locked pills showing placeholder labels + message |
| Locked (deadline passed) | Existing read-only behaviour unchanged |

### Click interaction

- Clicking a team pill picks that team as winner for that match
- Clicking the other team switches the pick (no deselect — a winner is always required)
- Changing an existing pick **cascades**: all downstream bracket slots whose resolved team
  came from this match are cleared, forcing the player to re-pick through the bracket

### Cascade clearing

When a pick at `round/slot` changes from one team to another, a BFS traversal of
`BRACKET_STRUCTURE` clears every downstream slot that listed this `round/slot` as its source:

```js
function clearDownstream(editBracket, round, slot) {
  const cleared = { ...editBracket };
  const queue = [[round, slot]];
  while (queue.length > 0) {
    const [r, s] = queue.shift();
    BRACKET_STRUCTURE.forEach(roundDef => {
      roundDef.matches.forEach(match => {
        const depends = (match.a?.from === r && match.a?.slot === s)
                     || (match.b?.from === r && match.b?.slot === s);
        if (depends) {
          const k = `${roundDef.id}-${match.slot}`;
          if (cleared[k]) { delete cleared[k]; queue.push([roundDef.id, match.slot]); }
        }
      });
    });
  }
  return cleared;
}
```

Called only when the player changes an existing pick (not on first selection).

### Unresolved slot UI

When `!bothKnown` (one or both team labels are still placeholders like "1º Gr.X" or "Melhor 3º"):

- Show both pills in a dimmed/locked style displaying their placeholder labels
- Below the pills, show a small message instead of a dropdown:
  > "A aguardar definição — resolve os grupos ou seleciona vencedores anteriores"
- No interaction possible until both teams resolve

### Rendering change (both-known case)

Replace the `<select>` block with two clickable pill buttons:

```js
if (bothKnown && !locked) {
  // Two clickable pills, no dropdown
  return h("div", { className: "bracket-match" },
    h("div", { style: { display: "flex", gap: "6px" } },
      [teamA, teamB].map(team =>
        h("button", {
          className: `bracket-pill${picked === team ? " bracket-pill--picked" : ""}`,
          onClick: () => {
            if (picked === team) return;           // already picked, no-op
            let eb = { ...state.editBracket, [key]: team };
            if (picked) eb = clearDownstream(eb, round.id, match.slot);
            state.editBracket = eb;
            render();
          }
        }, teamWithFlag(team))
      )
    )
  );
}
```

The existing `<select>` block is kept for the `locked` case (read-only after deadline) and
removed for the live case when both teams are known.

### CSS additions

```css
.bracket-pill {
  flex: 1; padding: 8px 4px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.05);
  color: #fff; font-size: 11px; font-weight: 600;
  cursor: pointer; font-family: inherit; text-align: center;
  transition: background 0.15s, color 0.15s;
}
.bracket-pill--picked {
  background: #34d399; color: #0f172a;
  border-color: #34d399;
}
.bracket-pill:not(.bracket-pill--picked):hover {
  background: rgba(255,255,255,0.1);
}
```

---

## Files to modify

- `index.html`:
  - Line ~759: back button `onClick` and label
  - Line ~932: nav active tab logic
  - `renderBracket()`: replace `<select>` with pill buttons for known-teams case,
    add pending-state message for unknown-teams case
  - Add `clearDownstream()` function near other bracket helpers
  - Add `.bracket-pill` and `.bracket-pill--picked` CSS
- No Edge Function changes, no DB changes
