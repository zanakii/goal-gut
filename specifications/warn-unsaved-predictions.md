# Spec: Warn When Leaving Predictions Without Submitting

## Problem

Users edit scores in the Predictions tab and then navigate away (tab switch, back button, or
browser close) assuming the changes are saved. `editPreds` is kept in JS state, so scores appear
intact if they return to the tab in the same session — reinforcing the false belief that edits
persist. A page refresh loses everything silently.

## What already exists

`state.predictionsEdited` is already set to `true` whenever a score input changes or an Excel
import is applied, and reset to `false` after a successful submission or player switch. It is
never used for navigation guarding today.

## Trigger condition

Warn when **all three** are true:
- `state.predictionsEdited === true`
- `!state.deadlinePassed`
- The user is navigating away from the predictions tab (in-app) **or** closing/refreshing the
  page (browser-level), regardless of current view

Do **not** warn when the deadline has passed — there is nothing left to submit.

---

## Two surfaces to guard

### 1. In-app navigation

All in-app view changes go through `setState({ view: ... })`. There are four navigation points
that can take the user away from the predictions tab:

| Location | Code |
|----------|------|
| Nav bar tabs | `setState({ view: t.id })` (line ~934) |
| Bracket "← Jogos" back button | `setState({ view: "matches" })` (line ~759) |
| Match card click (→ matchDetail) | `setState({ ... view: "matchDetail" })` (line ~976) |
| Match detail "← Voltar" button | `setState({ view: "matches" })` (line ~1049) |

Only the **nav bar** and the **bracket back button** are reachable while `view === "predictions"`.
The match card and detail back button are unreachable from the predictions tab.

**Implementation:** wrap the nav tab `onClick` handler with a guard function:

```js
function navigateTo(newView) {
  if (state.predictionsEdited && !state.deadlinePassed && state.view === "predictions") {
    if (!confirm("Tens prognósticos por submeter. Se saíres agora, as alterações serão perdidas. Continuar?")) return;
  }
  setState({ view: newView });
}
```

Apply the same guard to the bracket "← Jogos" back button's `onClick`.

### 2. Browser close / page refresh (`beforeunload`)

Register a `beforeunload` listener once, on page load. The browser shows its own native dialog
(the message string is ignored in modern browsers, but should still be set for older ones):

```js
window.addEventListener("beforeunload", (e) => {
  if (state.predictionsEdited && !state.deadlinePassed) {
    e.preventDefault();
    e.returnValue = "Tens prognósticos por submeter.";
  }
});
```

This covers: closing the tab, refreshing, navigating to a different URL.

---

## Message (in-app confirm)

> "Tens prognósticos por submeter. Se saíres agora, as alterações serão perdidas. Continuar?"

Keep it factual and in Portuguese, consistent with existing alert copy.

---

## Edge cases

- **User clicks Cancel on confirm** → navigation is blocked, user stays on predictions tab
- **User switches player** → `predictionsEdited` resets to `false` in `switchPlayer()`, so no
  spurious warning on the next navigation
- **User submits successfully** → `predictionsEdited` resets to `false` in `loadData()`, so
  `beforeunload` listener fires silently thereafter
- **Excel import** → sets `predictionsEdited = true`, so the guard correctly applies after
  an import that hasn't been submitted yet

---

## Files to modify

- `index.html` — add `navigateTo()` helper, update nav bar and bracket back button onClick,
  add `beforeunload` listener in the init block
- No Edge Function changes
- No DB changes
