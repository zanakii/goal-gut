# Spec: Analytics & Observability

## Problem

The app went live without any visibility into how it's being used. We can't tell whether
players are returning, whether anyone's stuck on a screen, or whether a silent JS error is
preventing submissions. For a beta with 8 friends this matters less than the public v2, but
we still need enough signal to nudge stragglers before the deadline and catch regressions
the same day they ship.

## Goal

Two layers, kept independent:

- **Layer 1 — anonymous traffic** (who's visiting, from where, when, on what device). No
  cookies, no banner.
- **Layer 2 — identified engagement** (which player did what, fired by the app itself
  against our own DB). Cheaper than third-party event tools and lets us correlate with
  prediction state.

Plus an observability track for errors and (later) session replay, so we can debug without
a player having to describe what they saw.

Cost ceiling: free for v1. Upgrade only when v2 widens the audience.

---

## Phase 1 — shipped (commit `d10714c`)

### Vercel Web Analytics

Single script tag before `</body>`:

```html
<script defer src="/_vercel/insights/script.js"></script>
```

No npm install — `index.html` has no build step, so the static-site script is the right
fit (the React/Next package would add a toolchain we don't need). Free tier ceiling is
**2,500 events/month**, which is plenty for 8 friends but worth re-checking once we open
the door wider (see "Watch list" below).

What we get: pageviews, unique visitors, top pages, devices, referrers, time-of-day
patterns, surfaced in the Vercel dashboard. No cookies, no GDPR banner, no PII.

### `app_events` table + `logEvent()`

```sql
CREATE TABLE app_events (
  id          bigserial PRIMARY KEY,
  player_id   uuid REFERENCES players(id) ON DELETE SET NULL,
  event       text NOT NULL,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_app_events_created_at        ON app_events (created_at DESC);
CREATE INDEX idx_app_events_player_created    ON app_events (player_id, created_at DESC);

ALTER TABLE app_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_events_insert ON app_events
  FOR INSERT TO anon, authenticated WITH CHECK (true);
-- No SELECT policy. Service-role (MCP / dashboard / future admin Edge Function) only.
```

Frontend helper, fire-and-forget:

```js
function logEvent(event, metadata = null) {
  if (!state.viewerPlayerId) return;
  fetch(`${SUPABASE_URL}/rest/v1/app_events`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
               "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ player_id: state.viewerPlayerId, event, metadata })
  }).catch(() => {});
}
```

Failures are swallowed — analytics never breaks the UX.

### Events instrumented

| Event             | Where it fires                          | Metadata                          |
|-------------------|------------------------------------------|-----------------------------------|
| `app_open`        | End of `loadData()`, once per page-load  | —                                 |
| `tab_view`        | After `setState({ view })` in `navigateTo` | `{ tab }`                       |
| `preds_submit`    | After successful `submitPredictions`     | `{ count }`                       |
| `bracket_submit`  | After successful bracket flow            | `{ picks, with_podium }`          |
| `pin_change`      | After successful `submitChangePin`       | —                                 |

A module-level `__appOpenLogged` flag prevents duplicate `app_open` rows during in-page
silent refreshes.

### Reference queries

```sql
-- Who's been active in the last 48h
SELECT p.name, MAX(e.created_at) AS last_seen, COUNT(*) AS events
FROM app_events e JOIN players p ON p.id = e.player_id
WHERE e.created_at > now() - interval '48 hours'
GROUP BY p.name ORDER BY last_seen DESC;

-- Engagement breakdown by event
SELECT p.name, e.event, COUNT(*) FROM app_events e
JOIN players p ON p.id = e.player_id
GROUP BY p.name, e.event ORDER BY p.name, e.event;

-- Daily opens
SELECT date_trunc('day', created_at)::date AS day,
       COUNT(*) FILTER (WHERE event = 'app_open') AS opens
FROM app_events GROUP BY 1 ORDER BY 1 DESC;
```

---

## Phase 2 — retention (next)

Engagement data is only useful around the tournament window. Beyond ~6 months, rows are
noise. A daily sweep keeps the table small.

```sql
-- Schedule daily via pg_cron (Supabase has it pre-installed in the `extensions` schema):
SELECT cron.schedule(
  'app_events_ttl',
  '0 3 * * *',                                  -- 03:00 UTC daily
  $$ DELETE FROM app_events WHERE created_at < now() - interval '180 days' $$
);
```

180 days covers the full tournament + a quarterly retro window after.

---

## Phase 3 — admin view (in-app)

A tab visible only to a flagged player, so we stop relying on me running SQL through MCP.

### Schema

```sql
ALTER TABLE players ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
UPDATE players SET is_admin = true WHERE name = 'Pedro';
```

### Edge Function `admin-stats`

`POST { player_id, pin }` → verifies PIN, checks `is_admin`, returns:

```json
{
  "active": [{ "player": "...", "last_seen": "...", "events": 12 }, ...],
  "by_event": [{ "player": "...", "event": "tab_view", "count": 7 }, ...],
  "daily": [{ "day": "2026-04-28", "opens": 5 }, ...],
  "submission_status": [
    { "player": "...", "group_preds": 72, "bracket_picks": 32, "has_podium": true }, ...
  ]
}
```

The function uses service role to read `app_events` (no SELECT policy on the table by
design), aggregates server-side, returns plain JSON.

### Frontend tab

A new `state.view === "admin"` branch. Shown in the navigation only when the authenticated
viewer's `is_admin` flag is set (the flag comes back from `get-predictions`'s player record
or a small `whoami` call). Renders three small tables (active in last 48h, daily opens,
submission completeness) and a "refresh" button that re-calls `admin-stats`.

No charts in v1.x — Chart.js is already loaded for the leaderboard, so a single line chart
of daily opens is cheap to add if we want it.

---

## Phase 4 — error / exception logging (Sentry)

The current error path is `alert("Erro: " + e.message)` in five places. That tells the user
something went wrong but tells us nothing.

Adopt **Sentry** (free tier: 5k errors/month, 100% sampling, 90-day retention):

```html
<script src="https://js.sentry-cdn.com/<dsn>.min.js" crossorigin="anonymous"></script>
<script>
  Sentry.onLoad(() => Sentry.init({
    environment: location.hostname === "goalgut.gg" ? "production" : "preview",
    tracesSampleRate: 0,                       // we don't need APM
    beforeSend(event) {
      // Strip the PIN if it ever ends up in a payload by accident.
      if (event?.request?.data) delete event.request.data.pin;
      if (event?.extra) delete event.extra.pin;
      return event;
    }
  }));
  // Tag the player so we can filter exceptions by who hit them
  if (state?.viewerPlayerId) Sentry.setUser({ id: state.viewerPlayerId });
</script>
```

In each `catch (e)`: keep the user-facing `alert`, add `Sentry.captureException(e)` so we
get the stack and breadcrumbs. Same for the silently-swallowed `logEvent` failures — those
should also report to Sentry (they shouldn't fail; if they do, we want to know).

Alternative considered: Vercel's "Log Drains" → log aggregator. Cheaper but requires us to
build the dashboard. Sentry's UI is the right tool.

---

## Phase 5 — session replay (Microsoft Clarity)

For UX bug reports of the form "I tried to submit and nothing happened" we want to *see*
what happened. Two free options:

- **Microsoft Clarity** — free, unlimited recordings, no cap. Drop-in script. Privacy-light
  but acceptable for a closed beta. PIN inputs already use `type="password"`, which Clarity
  masks by default; we'd add `data-clarity-mask="True"` to anything else sensitive.
- **PostHog free tier** — 5k recordings/month, also free. Heavier setup but pairs with
  funnels and feature flags if we ever want them.

Recommendation: **Clarity for v1.x**, evaluate PostHog when v2's feature work begins.

This is the lowest-priority phase — only worth pulling in if a real bug report needs it.

---

## v2 carry-over (definitely an issue)

When v2 introduces multi-pool / leagues:

- **`app_events` needs `pool_id`** (or `league_id`). Without it, aggregations across pools
  will mix users from different pools. Migration:

  ```sql
  ALTER TABLE app_events ADD COLUMN pool_id uuid REFERENCES pools(id);
  CREATE INDEX idx_app_events_pool_created ON app_events (pool_id, created_at DESC);
  ```

- **Admin view becomes per-pool.** `is_admin` becomes `pool_admins(pool_id, player_id)` so
  a single user can admin multiple pools they manage.
- **Vercel Analytics cap.** 2,500 events/month is fine at 8 friends. At 50–100 active
  users the cap will hit; that's the trigger to either upgrade to Vercel Pro (Analytics
  included) or move to Plausible/Umami.
- **Disclosure.** v2 is a public release; the implicit-consent model (you joined a friend's
  pool) doesn't apply. Add a one-line privacy note near the PIN-replacement (Supabase Auth)
  flow and a brief "what we log" entry in a Settings page.
- **Sentry, Clarity, PostHog** — all support multi-tenant tagging via `setUser` /
  `setContext`. Pass `pool_id` as a tag at session start.

Track these as part of milestone `v2.0-public-edition`.

---

## Watch list

- **Vercel Analytics monthly events** — check the dashboard once a week during the
  tournament. If it climbs past ~2,000, we're a sharing chain away from the cap.
- **`app_events` row count** — `SELECT count(*) FROM app_events;` once the cron is wired,
  should plateau around (8 players × ~30 events/day × 180 days) ≈ 43k. Anything wildly
  higher means logging is firing in a loop.
- **Sentry quota** — once enabled, watch the error rate the first few days; a noisy
  network handler can chew through 5k/month quickly.

---

## Files to modify

Phase 2:
- New SQL migration to schedule the pg_cron job.

Phase 3:
- New Edge Function `supabase/functions/admin-stats/index.ts`
- `index.html` — `admin` view, `is_admin` propagation from the player payload, nav entry.
- New SQL migration adding `players.is_admin`.

Phase 4:
- `index.html` — Sentry CDN snippet + `captureException` calls.
- Sentry project created and DSN stored (no secret — DSN is public-by-design).

Phase 5:
- `index.html` — Clarity snippet.
- Clarity project created.

---

## Out of scope

- **In-app disclosure of engagement logging** for v1 (friends-only). Will be added in v2.
- **Drop-off / funnel tracking** ("opened but didn't submit"). Possible to derive from
  `app_events` ad hoc; not worth the dashboard plumbing in v1.
- **Stopping logs after the deadline.** Cheap to leave on; rows are already capped by the
  TTL.
- **Custom Vercel Analytics events.** We'd be double-logging what `app_events` already
  captures. Stick with one source of truth per layer.
