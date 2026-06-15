# Spec: Reliable live-results pipeline (v0)

## Problem

The live-results poller has failed twice in the first four days of the tournament, both times leaving a real match silently stuck on the wrong score while GitHub Actions runs stayed green.

1. **2026-06-12 — frozen scores.** A combination of a too-coarse cron and a too-narrow date/lookback window stranded México 2-0 África do Sul (id 1) and Coreia do Sul 2-1 Rep. Checa (id 2). Hotfixed in `bfc150e` / `5b36a03` (lookback 4h→30h, API window now `yesterday..today`, cron relaxed).
2. **2026-06-15 — live match never listed.** Espanha vs Cabo Verde (id 43) kicked off at 16:00 UTC and sat at `status='scheduled'` because football-data.org returns the away side as **"Cape Verde Islands"**, while `team-map.js` only carried `"Cape Verde"`. Name-equality pairing fell through and the row was never touched. The log said `⚠ No DB match in window for Espanha vs Cape Verde Islands` — but nobody reads green-run logs mid-match. Hotfixed by adding the alias (`5924cad`).

Two distinct root causes sit under these incidents:

- **Triggering is unreliable.** GitHub treats `schedule` as best-effort and drops most fires. On 2026-06-15 the actual scheduled runs were `02:04`, `07:37`, `13:39` UTC — *hours* apart, not the 15 minutes the cron requests. A live match can therefore go 30–90 min with no update even when the code is perfect, and id 43 saw **no run at all** between kickoff and a manual `workflow_dispatch`.
- **Pairing is fragile.** Matching every poll on translated-name equality means any single upstream name drift strands a match forever, silently. There are 59 group games still unplayed — 59 unvalidated name mappings, each a latent "Cape Verde Islands".

These are independent of the per-incident hotfixes, which treated symptoms.

## Goal

- **Reliable triggering:** the poll fires on a dependable 1-minute cadence during the tournament months, not GitHub's best-effort scheduler — so live scores track the match in near-real-time.
- **Id-based pairing:** the live path pairs each upstream match to our row by a **stable football-data.org match id** seeded once, offline, from their full WC schedule — never by translated names. A name change upstream can no longer strand a match.
- **Loud failure:** any match the poller *can't* pair (in either direction) announces itself, instead of hiding in a green run.
- `team-map.js` leaves the fetch path entirely (display names already live in `matches.team_a/team_b`).

**Scope: v0 only.** The public edition (`goalgut/`) rebuilds the ingest pipeline against multi-tournament data; do not port this forward. Cross-ref: `_archive/live-results-fetching.md` (the system this supersedes).

---

## Part 1 — Id-based pairing

### Data model

```sql
alter table matches add column fd_match_id integer unique;
-- football-data.org's stable per-fixture id. Nullable: knockout rows
-- aren't seeded yet (matches table currently holds the 72 group games,
-- last kickoff 2026-06-28). Unique so a double-seed can't alias two rows.
```

No change to `team_a/team_b/kickoff/status/score_a/score_b`. `kickoff` stays `timestamp without time zone` (UTC-naive) — id pairing means we no longer compare it to upstream `utcDate` in the hot path, sidestepping the tz hazard flagged in the incident handoff.

### One-time seed (`seed-fd-ids.js`)

A standalone Node script, run once locally, header-commented like the other scripts:

1. Fetch the full WC fixture list: `GET /v4/competitions/WC/matches` (no date filter) → every fixture with its football-data `id`, `utcDate`, `homeTeam`, `awayTeam`.
2. For each of our 72 rows, resolve the upstream id by **kickoff time** (`our.kickoff` UTC == `match.utcDate`) — kickoffs are fixed and unique per slot in the group stage, so time is a far stabler join key than names. Where a slot has simultaneous kickoffs (final group round, two games at once), disambiguate with one translated team name via the *current* `team-map.js`, falling back to the upstream `(stage, group, matchday)` fields.
3. Print the proposed `our.id → fd_match_id (Home v Away @ kickoff)` mapping as a table and **stop**. Pedro eyeballs all 72, then a `--apply` flag writes them.

Doing the name reconciliation **once, with a human in the loop**, is the whole point: a bad match is caught at seed time by a person, not silently in production at kickoff.

> Knockout fixtures get the same treatment when those rows are added to `matches` (re-run `seed-fd-ids.js`; already-seeded rows are idempotent on the unique `fd_match_id`).

### Hot path change

```js
// before: name-equality pairing
const dbMatch = pending.find(p => p.team_a === translateTeam(match.homeTeam.name)
                              && p.team_b === translateTeam(match.awayTeam.name));
// after: id pairing
const dbMatch = pending.find(p => p.fd_match_id === match.id);
```

The pending query selects `fd_match_id`. `translateTeam` / `team-map.js` are removed from the fetch path. (The logic itself moves into the Edge Function — see Part 2 — but the pairing change is the same wherever it lands.)

### Loud failure (folds in the deferred safety nets)

- **Forward miss** — upstream match whose `match.id` matches no pending row → `⚠ unpaired upstream fixture {id} ({home} v {away}) — fd_match_id not seeded?`
- **Inverse miss** — pending DB match that got **no** upstream fixture in the window → `⚠ pending match {our.id} ({team_a} v {team_b}, KO {kickoff}) had no upstream result`. This is the line that would have surfaced the 2026-06-12 MEX–RSA date-window bug on the first run.

Both are `console.warn` (visible in Edge Function logs); a non-zero unpaired count is summarized in the final `Done.` line so it's visible without scanning.

---

## Part 2 — Reliable triggering

The poll logic moves into Supabase, triggered by `pg_cron` → `pg_net`, so triggering no longer depends on GitHub.

### `poll-results` Edge Function

A Deno/TS function in `supabase/functions/poll-results/`, same convention as the existing `submit-predictions/` etc. It is the port of `fetch-results.js`:

- smart-skip pending query (`status in (scheduled,live)`, 30h lookback window — carried over from the hotfix)
- football-data fetch (`dateFrom=yesterday&dateTo=today`)
- **id-based pairing** (Part 1) — no `team-map.js`
- idempotent PATCH (skip when score+status unchanged, so `updated_at` doesn't churn)
- the forward/inverse miss warnings

`FOOTBALL_DATA_TOKEN` becomes a Supabase function secret (`supabase secrets set`), read via `Deno.env.get`, not a GitHub Secret. The service-role write happens in-process against the local DB — no PostgREST round-trip for the PATCH.

The function is **not** openly invokable: it writes with the service role, so it verifies a shared cron key (see auth note below) rather than accepting any anonymous POST.

### `pg_cron` + `pg_net` trigger

```sql
-- every minute, June–July only, delegated to pg_net
select cron.schedule('poll-results', '* * * 6,7 *', $$
  select net.http_post(
    url     := 'https://thjvoocszfzqkyatkevv.supabase.co/functions/v1/poll-results',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Key',   current_setting('app.cron_key')
    )
  );
$$);
```

`pg_cron` honours its schedule (it's a Postgres job, not best-effort), giving the dependable cadence GitHub won't. Smart-skip still elides the upstream call on rest-day / no-pending fires.

### Why this cadence is free

- **football-data.org** — free tier 10 req/min, no daily cap. With smart-skip, ≤1 request/min during matches against a 10/min ceiling.
- **Supabase** — `pg_cron` has no per-run quota. The metered surface is Edge Function invocations: 1/min scoped to June+July ≈ **88k fires**, under the **free 500k invocations/month**. `pg_net` load at 1/min is negligible.

1 minute is the floor of native `pg_cron` granularity and live data doesn't refresh meaningfully faster, so we stop there.

### Decommission

- Delete `.github/workflows/fetch-results.yml` and `fetch-results.js` once `poll-results` has run clean through a full match day.
- `team-map.js` is dead after the seed (used only by the one-time `seed-fd-ids.js`) — delete in the same cleanup.

Per project working defaults, run `get_advisors` (security + performance) after the migration — `pg_net`, `pg_cron`, and the function secret all warrant a look.

---

## Reversibility

- The `fd_match_id` column is additive and nullable; until `poll-results` is enabled, the existing GitHub poller keeps running unchanged. The two systems can run **in parallel** for a match day (both writes are idempotent) before the GitHub one is cut — a low-risk cutover.
- Rolling back triggering is `select cron.unschedule('poll-results')` + re-enable the workflow. The `fd_match_id` column and the Edge Function can stay regardless.

## Out of scope

- Backfilling `fd_match_id` for knockout rows — those rows don't exist in `matches` yet; the same seed script handles them later.
- Any change to scoring, the predictions/bracket flow, RLS, or the deadline/reveal gates — the poller writes only to `matches` (unchanged from `_archive/live-results-fetching.md`).
- Retrying/queueing on upstream outage — smart-skip + 1-min cadence already self-heals on the next fire.
- Alerting to a human channel (WhatsApp/email) on an unpaired warning — logs only for v0; revisit if a miss recurs.

## Open questions

- **Edge Function auth.** Settle the `poll-results` auth: deploy with `--no-verify-jwt` and check the `X-Cron-Key` shared secret (set as a function secret and as the Postgres `app.cron_key` GUC), vs. passing the service-role JWT from `pg_cron`. The shared-key route keeps the cron call simple and the function un-invokable by anon; lean that way unless it complicates secret management.
- **Seed disambiguation for simultaneous kickoffs.** Confirm the final-round group games (two per group at the same UTC time) resolve cleanly on kickoff + one-name, or need the `(stage, group, matchday)` fallback. Verified at seed time by the human-eyeball step, so low risk.
