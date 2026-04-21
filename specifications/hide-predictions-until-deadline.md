# Spec: Hide Own Predictions Until Deadline

## Problem

Currently all players' predictions are fetched client-side at boot and are visible to anyone who
opens the app. A player can see rivals' picks before submitting their own, undermining competition
integrity. Additionally, the Matches tab leaks the authenticated player's own predicted scores
inline on each match card.

## Goal

Before the submission deadline:
- Require PIN verification at boot to identify the player
- Return only that player's own predictions from the backend (not all players')
- Remove all prediction previews from the Matches tab

After the deadline:
- No authentication required — everything visible to anyone

---

## User-facing behaviour

| When | Matches tab | Predictions tab | Bracket tab | Leaderboard |
|------|------------|-----------------|-------------|-------------|
| Pre-deadline, not authenticated | Match cards + scores only, no prediction previews | PIN modal shown | PIN modal shown | Empty (no results yet) |
| Pre-deadline, authenticated | Match cards + own prediction preview ("Eu: X-Y") | Full edit flow | Full edit flow | Empty (no results yet) |
| Post-deadline | Match cards + own predictions; match detail shows all | Read-only | Read-only | Fully visible |

---

## Authentication flow (pre-deadline only)

1. On boot, `init()` checks `state.deadlinePassed`.
2. If deadline has **not** passed: before rendering any predictions, show a **"Quem és tu?"**
   modal listing all player names. Player taps their name.
3. Immediately prompt for PIN in the existing PIN modal.
4. On success: store `viewerPlayerId` in state and in `localStorage` (`goalgut_player_id`) so
   subsequent visits within the same browser skip step 2–3.
5. If `localStorage` has a stored ID: skip the name picker, go straight to PIN verification on
   boot.
6. A "Trocar jogador" link in the player dropdown clears `localStorage`, resets
   `viewerPlayerId`, and re-shows the name picker + PIN modal.

**After deadline:** skip all of the above. `viewerPlayerId` is irrelevant; no PIN required to
load the app.

---

## Backend: new `get-predictions` Edge Function (Option B)

Replace the direct `sbGet("predictions", "select=*")` call in `init()` with a call to a new
Edge Function.

### Request
```
POST /functions/v1/get-predictions
{ player_id: number, pin: string }
```

### Response — pre-deadline (PIN valid)
```json
{
  "own": [ { player_id, match_id, score_a, score_b }, ... ],
  "others": null
}
```

### Response — post-deadline (PIN not required, player_id + pin can be omitted)
```json
{
  "own": [ ... ],
  "others": [ ... ]   // all predictions for all players
}
```

### Response — invalid PIN
```json
{ "error": "invalid_pin" }   // HTTP 401
```

The function checks the deadline from `tournament_config` server-side, so the client cannot
spoof a post-deadline request to get all predictions early.

Same pattern applies to `podium_predictions` and `bracket_predictions` — the function returns
own-only pre-deadline, all post-deadline.

---

## Matches tab changes

Two places currently leak prediction data pre-deadline:

1. **Match cards** (`renderMatches`, line ~982): the `"Eu: X - Y"` / `"✓ X - Y"` line beneath
   each score. Remove this line entirely when `!state.deadlinePassed && !state.authenticated`.
   Show it normally when authenticated (own predictions only are in state).

2. **Match detail** (`renderMatchDetail`, line ~1038): shows all players' predictions for a
   match. Pre-deadline and not authenticated: hide this section entirely or show a locked
   message. Pre-deadline and authenticated: show only own row. Post-deadline: show all rows
   as today.

---

## State changes

```js
// new fields
viewerPlayerId: null,     // player_id confirmed by PIN at boot
authenticated: false,     // true after PIN verified at boot
identityModalOpen: false, // name-picker modal
```

`currentPlayer` continues to drive the edit flow (whose predictions are loaded into `editPreds`).
`viewerPlayerId` is the identity confirmed by PIN; pre-deadline they must match.

---

## `init()` boot sequence (updated)

```
1. Fetch players + matches + tournament_config (no predictions yet)
2. Parse deadline → set deadlinePassed
3. If deadlinePassed:
     a. Fetch all predictions directly (no PIN needed)
     b. Render normally
4. If not deadlinePassed:
     a. Read localStorage for stored player_id
     b. Show name picker if no stored id
     c. Show PIN modal → call get-predictions on success
     d. On 401: show error, re-prompt
     e. On success: set authenticated = true, populate allPreds with own data only
```

---

## Files to modify

- `index.html` — name picker modal, boot sequence in `init()`, prediction masking in
  `renderMatches()` and `renderMatchDetail()`, "Trocar jogador" in player dropdown
- `supabase/functions/get-predictions/index.ts` — new Edge Function
- No DB schema changes
- No GitHub Actions changes

---

## Out of scope

- Server-side enforcement via Supabase RLS (v2, requires proper JWT auth)
- PIN recovery flow (handled manually via DB access; PIN change spec is a separate issue)
- Showing a countdown to when predictions will be revealed
