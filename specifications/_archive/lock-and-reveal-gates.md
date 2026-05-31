# Spec: Lock & Reveal — Two Independent Gates (v0)

## Problem

Today the `submission_deadline` row in `tournament_config` does double duty:

1. **Lock gate** — `submit-predictions`/`submit-bracket` Edge Functions reject writes once `now > submission_deadline` (`supabase/functions/submit-predictions/index.ts:53`, `supabase/functions/submit-bracket/index.ts:53`).
2. **Reveal gate** — `get-predictions` flips to "return everyone's predictions, no PIN" (`supabase/functions/get-predictions/index.ts:28`), and the table-level RLS policies on `predictions` / `podium_predictions` / `bracket_predictions` start returning rows to anon (see `_archive/hide-predictions-until-deadline.md`).

That coupling creates an awkward moment around the deadline. The current submission status is **3/10 non-observers with scores in, 2/10 with full bracket**. Even if the rest submit at the last minute, anyone who submitted earlier feels their picks become public the very second the clock ticks past 23:59 — and the admin (Pedro Miguel, `id b7d61e91-217f-427c-a8d5-880240802a7f`, `short_name PM`) loses the ability to nudge stragglers without the early submitters' picks being already visible to those still-undecided stragglers, which is a competitive integrity problem in reverse.

We want the lock to stay where it is — hard, no negotiation — and pull reveal off it onto its own row. The natural anchor is the opening match of the tournament (2026-06-11).

## Goal

- Add a `reveal_at` row to `tournament_config`, independent of `submission_deadline`.
- `reveal_at` defaults to **first-match kickoff**, which is already in our DB: `select min(kickoff) from matches` → `2026-06-11 19:00:00 UTC` (México vs África do Sul at Estadio Azteca, 20:00 Lisbon in summer DST). The FIFA schedule has been locked since the December 2025 draw and the `matches` table is already seeded — no external "to be confirmed" step.
- Pre-lock: today's pre-deadline behaviour (PIN, own-only).
- **Lock-passed but pre-reveal:** edits rejected, but visibility unchanged — each authenticated player still sees only their own predictions. The admin can chase stragglers in this window via service-role MCP; nobody else gets early information.
- Post-reveal: today's post-deadline behaviour (no PIN, everyone sees everyone).
- Admin (Pedro Miguel, `short_name PM`) keeps full service-role visibility throughout via MCP — no UI work needed.

**Scope: v0 only.** The public edition (`goalgut/`) will model these as per-pool config values, possibly per-stage. Do not port this implementation forward — see `ROADMAP.md`.

---

## User-facing behaviour

Three states now, where today there are two:

| When | Predictions / Bracket tab | Matches tab | Leaderboard | Auth required |
|------|---------------------------|-------------|-------------|---------------|
| Pre-lock, not authenticated | PIN modal | Match cards + scores, no prediction previews | Empty (no results) | Yes (own-only after PIN) |
| Pre-lock, authenticated | Full edit flow | Own prediction preview ("Eu: X-Y") | Empty | — |
| **Lock-passed, pre-reveal, not authenticated** | **PIN modal** | **Scores only, no prediction previews** | **Empty / partial** | **Yes (own-only after PIN)** |
| **Lock-passed, pre-reveal, authenticated** | **Inputs disabled, no submit button, "⏰ Prazo encerrado — revelação em DD/MM HH:mm" banner. Own predictions still visible (read-only).** | **Own preview only** | **Empty / partial** | **—** |
| Post-reveal | Inputs disabled, all players' picks visible, "⏰ Prazo encerrado" banner (no countdown) | All predictions visible on match detail | Fully visible | None |

Bold rows are new behaviour.

### Why keep the PIN gate during lock-pre-reveal

It looks redundant — nobody can edit anyway — but it has a real job: **letting players who submitted re-open the app and confirm what they actually submitted**, without exposing their picks to anyone who didn't (yet) submit and might be tempted to peek. The PIN is the "you are who you say you are" check that justifies showing the picks. Without it, we'd either have to show everyone's picks (which is the whole point we're avoiding) or show nobody's (which makes the app useless during the chase window).

A player who never submitted can still log in during this window — they'll see empty prediction blocks, which is the right "you didn't submit anything" experience.

### Banner copy in the lock-but-pre-reveal window

Replace the current `index.html:1759-1763` "⏰ Prazo encerrado" block with a slightly longer message:

```
⏰ Prazo encerrado
Os prognósticos de todos serão revelados no início do torneio (DD/MM HH:mm).
```

Once `reveal_at` passes, drop the second line and keep the existing single-line variant.

### "Quem és tu?" / PIN modal

Stays exactly as it is today, with one change: the modal is shown until `reveal_at` (not until `submission_deadline`). The boot sequence currently keys off `state.deadlinePassed` for both lock and reveal — split that into `state.lockPassed` and `state.revealPassed`. PIN is required iff `!state.revealPassed`.

---

## Data model

### `tournament_config` additions

```sql
insert into tournament_config (key, value) values
  ('reveal_at', '"2026-06-11T19:00:00Z"');
```

The value is derived from `(select min(kickoff) from matches)` at spec-ship time and pasted in literally — not computed on read. Static-with-override beats compute-on-read here: it lets the admin nudge reveal a couple of hours later (e.g. to align with when people will actually be gathered around) without touching match data, and it keeps the read path identical to `submission_deadline`'s.

Stored as a JSON string to match the existing `submission_deadline` row's shape (so the existing read path `cfg.value` continues to work without type-handling changes).

No new columns, no new tables, no migration to existing rows. `submission_deadline` keeps its current value `2026-06-04T23:59:59Z` and its current meaning ("lock").

### RLS policies — switch from `submission_deadline` to `reveal_at`

The read-gate policies added in `_archive/hide-predictions-until-deadline.md` currently look like:

```sql
USING (EXISTS (
  SELECT 1 FROM public.tournament_config
  WHERE key = 'submission_deadline'
    AND (value #>> '{}')::timestamptz < now()
))
```

on `predictions`, `podium_predictions`, and `bracket_predictions`. Replace `key = 'submission_deadline'` with `key = 'reveal_at'` on all three. The write paths don't go through these policies (service-role bypasses RLS), so this change only affects what anon sees.

The `players.code` column-level grant carve-out (also from that spec) stays exactly as is.

---

## Edge Function changes

### `get-predictions/index.ts`

One read swap. Today:

```ts
const { data: cfg } = await supabase
  .from('tournament_config')
  .select('value')
  .eq('key', 'submission_deadline')   // ← change to 'reveal_at'
  .single()

const deadlinePassed = cfg?.value ? new Date() > new Date(cfg.value) : false

if (deadlinePassed) {
  // Post-deadline: return all predictions without authentication
  ...
}
```

Becomes — query `reveal_at`, rename the local variable to `revealPassed`, keep the rest of the branching identical. The function's external contract stays the same: PIN-required pre-reveal, no-PIN post-reveal.

### `submit-predictions/index.ts` and `submit-bracket/index.ts`

**No change.** They already check `submission_deadline`, which now exclusively means "lock". The error message `"Prazo de submissão encerrado"` continues to be correct.

### `change-pin/index.ts`

No change. PIN changes are unrelated to either gate.

---

## Frontend changes

### State

```js
// today
deadline: null, deadlinePassed: false,

// after
lockDeadline: null,  lockPassed: false,
revealAt: null,      revealPassed: false,
```

The leaderboard already gates on its own logic (`_archive/leaderboard-v0-dinner-split.md`) and reads match results, not the prediction gates — no change there.

### `init()` boot sequence

Update the `tournament_config` fetch at `index.html:404` to also pull `reveal_at`:

```js
sbGet("tournament_config", "key=in.(submission_deadline,reveal_at,actual_podium)")
```

Parse both into `state.lockDeadline` / `state.lockPassed` and `state.revealAt` / `state.revealPassed`. The PIN-required test currently at `index.html:454, 460` flips from `deadlinePassed` to `revealPassed`:

```js
authenticated: revealPassed || state.authenticated,
...
if (!revealPassed && !state.viewerPlayerId) initiateIdentityFlow();
```

### Render-site sweep

Every existing `state.deadlinePassed` reference is one of:

- **Lock concern** (disable inputs, hide submit, show "Prazo encerrado" banner): keep — rename to `state.lockPassed`. Hits: `index.html:521, 874, 933, 1726, 1768, 1972`, plus the navigation guards at `1088, 1091`, and the "Auditoria" buttons at `1190, 1450`.
- **Reveal concern** (show all-vs-own, drop authentication requirement): switch to `state.revealPassed`. Hits: the auth-flow assertions at `454, 460`, the visibility branches at `416, 438`, and the "see other predictions" surfaces in the matches tab (`renderMatchDetail` — verify line numbers; the existing pattern in `_archive/hide-predictions-until-deadline.md` notes it lives around line ~1038, may have shifted since).

Audit each `deadlinePassed` site and reassign deliberately. There are ~20 references in `index.html`; none of them are ambiguous once you ask "is this about editing or about visibility?".

The `state.deadlinePassed` field is removed in favour of the two new fields. No backwards-compatibility shim.

---

## Admin model

The admin (Pedro Miguel, `id b7d61e91-217f-427c-a8d5-880240802a7f`, `short_name PM`) has no UI for either gate. Both are toggled by direct SQL on `tournament_config`:

```sql
-- nudge reveal later (e.g. align with when the group is gathered to watch the opener)
update tournament_config set value = '"2026-06-11T20:30:00Z"' where key = 'reveal_at';

-- extend the lock (rare — only if the group agrees)
update tournament_config set value = '"2026-06-05T23:59:59Z"' where key = 'submission_deadline';
```

The admin retains full service-role visibility through MCP throughout the lock-pre-reveal window — that's how stragglers are chased:

```sql
-- who's still missing scores
select p.name, count(pr.id) as submitted, 72 as expected
from players p left join predictions pr on pr.player_id = p.id
where not p.is_observer
group by p.name having count(pr.id) < 72;
```

No `is_admin` column or admin view is added by this spec. That was Phase 3 of the analytics-and-observability spec, deferred to the public edition (see `_archive/analytics-and-observability.md` for the rationale).

---

## Reversibility

The change is fully reversible without code:

- **Restore today's behaviour** in one statement: `update tournament_config set value = (select value from tournament_config where key = 'submission_deadline') where key = 'reveal_at';` — setting `reveal_at = submission_deadline` collapses the two gates back into one moment.
- **Punt reveal indefinitely:** set `reveal_at` to a far-future timestamp. Players will be stuck behind their PIN forever, which is bad UX, but reversible.

The RLS policy switch and the `get-predictions` query swap are one-line changes that can be inverted if it turns out the public expectation is "reveal at the deadline, not at first kickoff".

---

## Out of scope

- A countdown in the banner — the date+time is enough; we don't need a ticking clock.
- Per-stage reveal gates (e.g. "knockout picks reveal separately"). One reveal, all predictions, deliberate simplicity.
- An admin UI for editing either config value. SQL is fine for one admin and a friend group.
- Emailing players when reveal happens. They're in a WhatsApp group; the WhatsApp ping is the notification.
- Telling the player how long until reveal in a tooltip / dedicated screen beyond the banner. Banner is enough.

## Open questions

- **Behaviour if a player has zero submissions when reveal hits.** The current code path renders empty predictions blocks for them — confirm that still looks acceptable in the post-reveal "see everyone" view, vs. labelling them explicitly as "did not submit". Probably fine to leave empty in v0.
