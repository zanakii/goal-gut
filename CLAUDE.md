# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**Goal Gut** — a private World Cup 2026 predictions pool for a closed group of friends, live at [goalgut.gg](https://goalgut.gg).

Players predict group-stage scores (72 matches) and knockout bracket winners. Scoring is **golf-style** — penalty points accumulate per match and the leaderboard sorts ascending (lowest total wins, exact prediction = 0). A cumulative score chart updates automatically as results come in.

**Architecture:**
- `index.html` — entire frontend (vanilla JS + CSS, no framework, no build step)
- Supabase — PostgreSQL database + Edge Functions (project: `thjvoocszfzqkyatkevv`, region: `eu-west-1`)
- Vercel — static hosting, auto-deploys from `main`
- GitHub Actions — scheduled result fetching every 10 min during match hours (June 2026)

This is **v1.0** — a deliberately simple, single-pool edition. Do not refactor toward a framework or introduce auth libraries; v2.0 (SvelteKit/Next.js + Supabase Auth) is planned post-tournament. See `ROADMAP.md`.

## Frontend (`index.html`)

Single file, ~1700 lines. No build step — edit and push; Vercel deploys it.

Key patterns:
- **State-driven rendering:** a single `state` object + `render()` function controls all UI. Mutate state via `setState({...})` which calls `render()`.
- **Tabs:** `state.view` — values: `"matches"`, `"predictions"`, `"bracket"`, `"leaderboard"`
- **Identity:** PIN-based. `state.viewerPlayerId` holds the authenticated player; stored in `localStorage` as `goalgut_player_id` for return visits.
- **Deadline:** fetched from `tournament_config` at boot. Pre-deadline: predictions are hidden and PIN-gated. Post-deadline: all predictions visible to everyone.
- **Scoring:** `calcPts(pred, m)` returns **penalty points** (lower = better, exact = 0). It sums two parts: an **outcome penalty** — 0 if the predicted winner/draw matches the actual result, +3 if wrong with a draw involved on either side, +5 if both sides picked a winner but the wrong one — and a **goal-error penalty** equal to `|score_a - pred_a| + |score_b - pred_b|`. `isExact(pred, m)` returns true when both scores match exactly. `calcPodiumPts(podiumArr, tournamentState)` scores the optional 1-2-3 podium pick after the group stage ends: 0 for correct slot, +10 for right team in wrong slot, +20 for missing/eliminated/wrong (max 60). The leaderboard sorts ascending. Do not duplicate this logic elsewhere — `badgeColor` thresholds in `index.html` are calibrated to this scale.
- **Excel:** SheetJS (`xlsx`) handles template generation and import. `generateTemplate()` builds the download; import reads the same format.
- **Charts:** Chart.js for the leaderboard score trend.

All team names are in **Portuguese** (`Brasil`, `França`, `Países Baixos`, etc.).

## Supabase Edge Functions

Located in `supabase/functions/`. Written in **Deno + TypeScript**. Use the service-role key (full DB access, bypasses RLS).

**⚠️ Edge Functions are NOT auto-deployed.** After editing, run:
```bash
supabase functions deploy <function-name>
```

| Function | Method | Purpose |
|---|---|---|
| `get-predictions` | POST | Fetch predictions — own-only pre-deadline (PIN required), all post-deadline |
| `submit-predictions` | POST | Save group-stage score predictions + optional podium; verifies PIN + deadline |
| `submit-bracket` | POST | Save knockout bracket picks; verifies PIN + deadline |
| `change-pin` | POST | Self-service PIN change; verifies current PIN, validates new PIN ≥ 4 chars |

All functions:
- Verify PIN server-side against `players.code`
- Check `tournament_config.submission_deadline` before allowing writes
- Return `401 { error: "invalid_pin" }` on PIN mismatch
- Allow `*` CORS origin

## Database

Key tables:

| Table | Purpose |
|---|---|
| `players` | Player list — `id`, `name`, `code` (PIN) |
| `matches` | 72 group-stage + knockout fixtures — `group_letter`, `team_a`, `team_b`, `kickoff` (UTC), `venue`, `status` |
| `predictions` | Score predictions — `player_id`, `match_id`, `score_a`, `score_b` |
| `podium_predictions` | Tournament winner/runner-up/third predictions |
| `bracket_predictions` | Knockout picks — `player_id`, `round`, `slot`, `picked_team` |
| `tournament_config` | Key-value config — notably `submission_deadline` (UTC ISO string) |

All team names are in Portuguese. Match times are stored in UTC.

## Node.js scripts

Require `.env` with `SUPABASE_CONNECTION_STRING` and `API_FOOTBALL_KEY`.

```bash
node seed-matches.js      # Insert 72 group-stage matches (ON CONFLICT DO NOTHING — safe to re-run)
node seed-knockout.js     # Insert knockout fixtures
node fetch-results.js     # Fetch and write match results from api-football.com (run by GitHub Actions)
node find-league.js       # Discover api-football league IDs
node test-api.js          # Test fixture fetch from api-football.com
```

## Result fetching

`.github/workflows/fetch-results.yml` runs `node fetch-results.js` on a cron schedule every 10 minutes during match hours in June 2026. API key and Supabase credentials are in GitHub Secrets (`API_FOOTBALL_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`).

`team-map.js` maps api-football team names to the Portuguese names used in the database.

## Environment variables

Loaded from `.env` (gitignored). Never hardcode credentials.

```
SUPABASE_CONNECTION_STRING=   # Direct PostgreSQL connection (used by seed/fetch scripts)
API_FOOTBALL_KEY=             # api-sports.io key (100 req/day free tier)
```

Edge Functions use their own environment variables configured in the Supabase dashboard (service-role key injected automatically by the runtime).
