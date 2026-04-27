# Spec: Player PIN Change

## Goal

Allow players to replace their randomly-assigned PIN with something more memorable,
self-service, without admin involvement. Surfaces at two moments: right after first
successful authentication (optional prompt), and on-demand via a persistent entry point
in the player dropdown.

---

## Context

11 players. No emails. PINs currently live in `players.code`, verified server-side via the
`submit-predictions` Edge Function. The admin (Pedro) retains DB access as the fallback for
a locked-out player — no recovery flow needed in the app.

---

## Dependency

The "first-access prompt" (step 2 below) requires the boot PIN flow introduced in the
hide-predictions spec. Implement change-pin after that spec is live, or bundle them.

---

## User flows

### Flow A — first access prompt

Triggered immediately after the player successfully authenticates at boot (hide-predictions
spec), **if** `localStorage` does not contain `goalgut_pin_set_{player_id}`.

1. Show an optional modal:
   > "💡 Queres definir um PIN mais fácil de memorizar?"
   > [Sim, alterar] [Agora não]
2. "Agora não" → dismiss, do not show again this session (but persistent icon remains)
3. "Sim, alterar" → open the change PIN modal (see below)
4. On success → set `localStorage` flag `goalgut_pin_set_{player_id} = "1"` so the prompt
   never appears again for this player on this device

The `localStorage` flag is device-scoped, which is acceptable — it prevents nagging on the
device they normally use, while still allowing a change via the persistent icon on any device.

### Flow B — persistent icon (on-demand)

A "🔑 Alterar PIN" option added to the existing player dropdown menu, visible at all times
across all tabs. Clicking it opens the change PIN modal directly, skipping the prompt step.

---

## Which player's PIN is being changed

This is a critical safeguard. `state.currentPlayer` (the dropdown selection) is **not** the
right identity to use — a player could switch the dropdown to a teammate and attempt to change
their PIN.

**After the hide-predictions spec is live:** always use `state.viewerPlayerId` (the PIN-verified
boot identity) as the `player_id` sent to the Edge Function. Even if the player is browsing
another player's predictions via the dropdown, "Alterar PIN" always targets their own
authenticated identity.

**Before the hide-predictions spec is live:** `viewerPlayerId` doesn't exist yet. In this case,
use `state.currentPlayer.id` but display the player name prominently in the modal header
("A alterar PIN de **[name]**") so it's unambiguous. Server-side verification of the current
PIN prevents unauthorised changes regardless.

**Sequencing recommendation:** implement change-pin after hide-predictions so `viewerPlayerId`
is always available and the UX is unambiguous. The two specs are already flagged as dependent.

---

## Change PIN modal

The modal header always shows which player's PIN is being changed:
> "A alterar PIN de **[player name]**"

Single-screen form, three fields:

```
PIN atual      [ ________ ]
Novo PIN       [ ________ ]
Confirmar PIN  [ ________ ]
               [ Confirmar ]  [ Cancelar ]
```

**Validation (client-side before submit):**
- All fields non-empty
- Novo PIN === Confirmar PIN (mismatch → inline error, no server call)
- Novo PIN ≠ PIN atual (pointless change → inline error)
- Novo PIN min 4 characters

**On submit:** call new `change-pin` Edge Function. On success: dismiss modal, show brief
toast "PIN alterado com sucesso". On 401 (wrong current PIN): inline error on "PIN atual"
field, fields not cleared.

**State fields to add:**
```js
showChangePinModal: false,
changePinValues: { current: "", next: "", confirm: "" },
changePinError: null,   // null | 'wrong_current' | 'mismatch' | 'too_short' | 'same'
changePinSubmitting: false,
changePinSuccess: false,  // drives the toast
```

---

## Backend: new `change-pin` Edge Function

```
POST /functions/v1/change-pin
{ player_id: number, current_pin: string, new_pin: string }
```

**Logic:**
1. Fetch `players` row by `player_id`
2. Verify `current_pin === row.code` — if not, return 401 `{ error: "invalid_pin" }`
3. Validate `new_pin` length ≥ 4 — if not, return 400 `{ error: "too_short" }`
4. `UPDATE players SET code = new_pin WHERE id = player_id`
5. Return 200 `{ ok: true }`

Uses the service role key (same pattern as `submit-predictions`). The `new_pin` format should
match whatever format the existing PINs use — check the `players` table before implementing
to confirm (numeric-only, alphanumeric, etc.) and add a regex guard if needed.

---

## Files to modify

- `index.html`:
  - Add `showChangePinModal`, `changePinValues`, `changePinError`, `changePinSubmitting`,
    `changePinSuccess` to state
  - Add `renderChangePinModal()` component
  - Add "🔑 Alterar PIN" to the player dropdown
  - After successful boot auth (hide-predictions spec): check `localStorage` flag and
    conditionally show the first-access prompt
  - Add toast rendering for `changePinSuccess`

- `supabase/functions/change-pin/index.ts` — new Edge Function

- No DB schema changes (updates existing `code` column)
- No GitHub Actions changes
