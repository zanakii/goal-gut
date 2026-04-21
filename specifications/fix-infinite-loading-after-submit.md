# Spec: Fix Infinite Loading After Prediction Submission

## Bug description

After submitting predictions (or the bracket), the app enters an unrecoverable loading state.
Predictions are saved to the DB correctly, but the user cannot make further changes without
reloading the page manually.

## Root causes (two separate bugs)

### Bug 1 — `submitting` / `bracketSubmitting` never reset on success

In `submitPredictions()` (line ~380), `state.submitting` is set to `true` before the fetch and
is only reset to `false` in the error path (line 401) and the catch block (line 406). The success
path (line 404) calls `await loadData()` and then exits — **no `setState({ submitting: false })`**.
`loadData()` does not reset `submitting` either.

Same issue in `submitBracket()` (line ~694) with `bracketSubmitting`.

Result: after a successful submission, the guard `if (state.submitting) return;` permanently
blocks any future submit attempt until the page is hard-reloaded.

### Bug 2 — `loadData()` called post-submission triggers a full-page loading spinner

`loadData()` immediately calls `setState({ loading: true })`. Because `render()` checks
`state.loading` first and returns early (line 1350), this wipes the entire UI and shows the
full-page spinner — the user perceives this as a page reload. The data re-fetches, `loading`
goes back to `false`, and the UI restores — but by then `submitting` is still `true` (Bug 1),
so the app appears stuck.

---

## Fix

### 1. Reset `submitting` / `bracketSubmitting` in the success path

In `submitPredictions()`, after `await loadData()` resolves:

```js
// before (line 404–405)
await loadData();
if (hadBracket) { state.bracketStale = true; render(); }

// after
await loadData();
state.submitting = false;          // direct mutation — loadData already called render()
if (hadBracket) { state.bracketStale = true; render(); }
```

In `submitBracket()`, after `await loadData()` resolves:

```js
// before (line 736)
await loadData();

// after
await loadData();
state.bracketSubmitting = false;
render();
```

### 2. Don't use the global loading spinner for post-submission refresh

`loadData()` should only show the full-page spinner on the initial boot load, not when called
as a background refresh after submission. Two options:

**Option A (minimal):** Add a `silent` parameter to `loadData()`:

```js
async function loadData(silent = false) {
  if (!silent) setState({ loading: true, error: null });
  else setState({ error: null });
  // ... rest unchanged
}
```

Call it as `await loadData(true)` from both submit functions.

**Option B (cleaner, recommended):** Extract a `refreshData()` function that re-fetches from
the DB and merges into state without touching `loading`. The submit functions call
`refreshData()` instead of `loadData()`. Initial boot continues to call `loadData()` as today.

Either option prevents the full-page spinner from firing mid-session.

---

## Expected behaviour after fix

1. User submits predictions → brief inline spinner on the submit button (already rendered via
   `state.submitting`)
2. Edge Function responds OK → data refreshes silently in the background
3. Submit button returns to its normal state; user can edit and resubmit immediately
4. No full-page spinner unless it is the initial page load

---

## Files to modify

- `index.html` — `submitPredictions()`, `submitBracket()`, `loadData()` (or new `refreshData()`)
- No Edge Function changes
- No DB changes
