# Spec: Move pg_net out of the `public` schema (v0)

## Problem

Shipping the reliable-live-results pipeline enabled `pg_net` with a bare `create extension pg_net` (migration `enable_cron_and_store_poll_secret`, 2026-06-15), which landed the extension in the **`public`** schema. Supabase's security advisor flags this as `extension_in_public` (WARN, [lint 0014](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public)): extensions in `public` sit on the default `search_path`, a minor object-shadowing / privilege surface.

The practical risk here is low — `pg_net`'s callable API (`net.http_post`) lives in its own `net` schema, not `public`; only the extension *registration* is in `public`. But the advisor stays red, and we run advisors clean as a working default.

It can't be relocated in place: `alter extension pg_net set schema extensions` errors with `0A000: extension "pg_net" does not support SET SCHEMA` (it pins its objects to `net`). The only route is **drop + recreate**, which touches the live `poll-results` cron that calls `net.http_post` every minute (June/July) — so it's deliberately deferred out of the live tournament window rather than done in place.

**Scope: v0 only.** Supabase-instance hardening for this project. Not user-facing.

## Goal

- Clear the `extension_in_public` advisor for `pg_net` (or, if it can't be cleared, document it as an accepted exception with the reasoning).
- Zero disruption to live scoring — the cutover happens in a window with nothing live, with the cron paused across the swap.

## When

The poller is idempotent and smart-skips, so the swap only needs a ~2-minute window where no match is live (a missed tick self-recovers next minute). Group-stage matches run daily (06-11→06-28), but there are long daily lulls (roughly 05:00–16:00 UTC) with nothing pending; knockout rest days (e.g. 2026-07-08, 07-13, 07-16/17) are the cleanest. **Do not** run this while a match is live or about to kick off.

## Implementation

```sql
-- 1. Pause the cron so no tick fires mid-swap.
select cron.unschedule('poll-results');

-- 2. Drop + recreate in the extensions schema. pg_net always creates/owns the
--    `net` schema for its API, so net.http_post keeps resolving regardless of
--    the extension's home schema.
drop extension pg_net;
create extension pg_net with schema extensions;

-- 3. Re-schedule — identical to the original (migration schedule_poll_results_cron).
select cron.schedule(
  'poll-results',
  '* * * 6,7 *',
  $job$
  select net.http_post(
    url := 'https://thjvoocszfzqkyatkevv.supabase.co/functions/v1/poll-results',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'poll_results_cron_secret')
    ),
    timeout_milliseconds := 10000
  );
  $job$
);
```

### Verify

1. `get_advisors(security)` no longer lists `pg_net` (or, if it still does, fall back to *accepted exception* below).
2. Manual smoke test: `curl -H 'x-cron-secret: <CRON_SECRET>' https://thjvoocszfzqkyatkevv.supabase.co/functions/v1/poll-results` → HTTP 200.
3. Confirm the next scheduled tick lands: `select status, start_time from cron.job_run_details where jobid = (select jobid from cron.job where jobname='poll-results') order by start_time desc limit 1;`
4. `select status_code from net._http_response order by created desc limit 1;` → 200.

## Reversibility

The swap is self-contained. If anything misbehaves, re-running step 2 as a plain `create extension pg_net` (public) plus step 3 restores the exact prior state. The `poll-results` function, `CRON_SECRET`, and Vault secret are untouched throughout — only the extension's home schema changes.

## Out of scope

- Moving any other extension. The advisor only flags `pg_net`; `pg_cron` is fine where it is.
- Rotating `CRON_SECRET` or touching the Edge Function. Pure DB-extension relocation.

## Open questions

- **Does `create extension pg_net with schema extensions` actually clear the lint?** `pg_net` hardcodes the `net` schema for its functions, so it's possible the extension still registers such that the advisor isn't satisfied. If the recreate doesn't clear it, the fallback is to **accept and document** the warning: the public footprint is only the extension registration (no callable functions in `public`), the API is in `net`, and the risk is negligible for a closed friend-group instance. Record that decision here and move on rather than chasing it further.
