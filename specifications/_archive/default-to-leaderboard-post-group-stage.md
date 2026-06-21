# Spec: Default to the leaderboard once the group stage ends (v0 only)

## Problem

The app always opens on the Matches tab — `view: "matches"` in the initial state
(`index.html:529`), with no logic to change it. That's the right landing during the group stage
(everyone's checking fixtures and their picks). But once the group stage is over, the story
shifts to *standings* — who's in the top half, podium picks resolving — and the Matches tab
becomes the knockout fixture record. Opening on Matches then makes the user take an extra tap to
reach the thing that now matters most.

## Goal

- **After `groupStageComplete`, default the opening section to the leaderboard** ("Classificação"),
  not Matches.
- Don't trap the user: any manual navigation in the session sticks, mirroring the
  `groupFilterTouched` pattern the Matches tab already uses.

**Scope: v0 only.** Reuses the default-flip mechanism from
[`_archive/matches-tab-fase-final-knockout-view.md`](_archive/matches-tab-fase-final-knockout-view.md).

---

## User-facing behaviour

Compute the landing view the way the Matches tab computes its default filter — at the moment data
lands, flip the view *once* if the user hasn't navigated yet:

```js
// after loadData populates matches, if the user hasn't navigated this session:
if (!state.viewTouched && computeActualTournamentState().groupStageComplete) {
  setState({ view: "leaderboard" });
}
```

- Before group stage complete → stays `"matches"` (unchanged).
- After complete, fresh load, untouched → opens on `"leaderboard"`.
- Any tab click sets `viewTouched: true` → the user's choice holds for the session; a page reload
  re-evaluates (and lands on the leaderboard again post-group-stage, which is what we want).

The leaderboard tab already only exists once `tournamentStarted()` (`index.html:1456`), so there's
no risk of defaulting to a hidden tab.

## Data model / Backend

None.

## Implementation notes

### Files touched
- `index.html` only.

### Where the logic lives
- **State**: add `viewTouched: false` to the initial state (`index.html:529`).
- **Touch flag**: set `viewTouched: true` in `changeView` (`index.html:1391`), alongside the
  existing `setState({ view: newView })`.
- **Default flip**: at the end of `loadData`, after the main `setState` (near `index.html:638`),
  apply the conditional above. `groupStageComplete` comes from `computeActualTournamentState()`
  (already used at `index.html:1628`).

### Order of work
1. Add `viewTouched` to state; set it in `changeView`.
2. Apply the post-load conditional flip in `loadData`.

---

## Out of scope
- Changing the tab *order* or hiding Matches.
- Any behaviour before the group stage ends.
- v1 (`goalgut/`).

## Reversibility

Two-line logic guarded on `groupStageComplete` (≈27 June) — a no-op until then. Revert by
removing the flag and the conditional.

## Testing

Gated on `groupStageComplete`, so not live-checkable until ~27 June — review per the "trust code
review when the gate hides the surface" default. To exercise early: force `groupStageComplete`
true in a branch and confirm a fresh load opens on Classificação, while clicking Jogos and then
reloading-free navigating keeps you where you chose.
