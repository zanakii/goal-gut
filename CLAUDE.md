# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Verify before recall

Before claiming any work is pending, in-flight, or unresolved based on a memory entry, verify against current code and `git log`. Memory entries are point-in-time observations and rot — a file named in memory may have shipped, been renamed, or been deleted. Memory is a hint about where to look, never a source of truth about current state.

## Project overview

**Goal Gut** — a private World Cup 2026 predictions pool for a closed group of friends, live at [goalgut.gg](https://goalgut.gg).

Players predict group-stage scores (72 matches) and knockout bracket winners. Scoring is **golf-style** — penalty points accumulate per match and the leaderboard sorts ascending (lowest total wins, exact prediction = 0). A cumulative score chart updates automatically as results come in.

**Architecture:**
- `index.html` — entire frontend (vanilla JS + CSS, no framework, no build step)
- Supabase — PostgreSQL database + Edge Functions (project: `thjvoocszfzqkyatkevv`, region: `eu-west-1`)
- Vercel — static hosting, auto-deploys from `main`
- GitHub Actions — scheduled result fetching every 2 min during match hours (June–July 2026)

This is the **v0** edition — a deliberately simple, single-pool edition. Do not refactor toward a framework or introduce auth libraries; the **public edition** (SvelteKit + Supabase Auth) is planned post-tournament. See `ROADMAP.md`.

## Frontend (`index.html`)

Single file, ~1700 lines. No build step — edit and push; Vercel deploys it.

Key patterns:
- **State-driven rendering:** a single `state` object + `render()` function controls all UI. Mutate state via `setState({...})` which calls `render()`.
- **Tabs:** `state.view` — values: `"matches"`, `"predictions"`, `"bracket"`, `"leaderboard"`
- **Identity:** PIN-based. `state.viewerPlayerId` holds the authenticated player; stored in `localStorage` as `goalgut_player_id` for return visits.
- **Deadline:** fetched from `tournament_config` at boot. Pre-deadline: predictions are hidden and PIN-gated. Post-deadline: all predictions visible to everyone.
- **Scoring:** `calcPts(pred, m)` returns **penalty points** (lower = better, exact = 0). It sums two parts: an **outcome penalty** — 0 if the predicted winner/draw matches the actual result, +3 if wrong with a draw involved on either side, +5 if both sides picked a winner but the wrong one — and a **goal-error penalty** equal to `|score_a - pred_a| + |score_b - pred_b|`. `isExact(pred, m)` returns true when both scores match exactly. `calcPodiumPts(podiumArr, tournamentState)` scores the optional 1-2-3 podium pick after the group stage ends: 0 for correct slot, +10 for right team in wrong slot, +20 for missing/eliminated/wrong (max 60). The leaderboard sorts ascending. Do not duplicate this logic elsewhere — `badgeColor` thresholds in `index.html` are calibrated to this scale. **Bracket picks (`bracket_predictions`) do not score independently** — the knockout bracket is a UX device that helps each player visualise seedings and draft the path to their 1-2-3 podium pick, which is the thing that actually scores via `calcPodiumPts`.
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

Require `.env` with `SUPABASE_CONNECTION_STRING` and `FOOTBALL_DATA_TOKEN`.

```bash
node seed-matches.js      # Insert 72 group-stage matches (ON CONFLICT DO NOTHING — safe to re-run)
node seed-knockout.js     # Fetch and insert knockout fixtures from football-data.org
node fetch-results.js     # Live + finished score poller (run by GitHub Actions)
node test-api.js          # Smoke-test the football-data.org connection
```

## Result fetching (live-results)

`.github/workflows/fetch-results.yml` runs `node fetch-results.js` every 2 minutes during match hours throughout June and July 2026 — covering the group stage and the entire knockout bracket through the final on July 19.

The poller writes **both live and finished** scores. Status vocabulary:
- `scheduled` — pre-kickoff
- `live` — match in progress (IN_PLAY / PAUSED / EXTENDED / SUSPENDED upstream)
- `finished` — terminal, settled in regulation or extra time
- `pen-home` / `pen-away` — terminal, decided on penalties (winner encoded in status)

Frontend invariant: `m.score_a !== null` means "show this score"; `isFinal(m)` means "this match is over — lock bracket/elimination logic on it". The leaderboard updates while a match is in progress.

API token and Supabase credentials are in GitHub Secrets (`FOOTBALL_DATA_TOKEN`, `SUPABASE_URL`, `SUPABASE_KEY`). The repo is public so Actions are unmetered.

`team-map.js` maps football-data.org team names to the Portuguese names used in the database.

See `specifications/live-results-fetching.md` for the full spec.

## Environment variables

Loaded from `.env` (gitignored). Never hardcode credentials.

```
SUPABASE_CONNECTION_STRING=   # Direct PostgreSQL connection (used by seed/fetch scripts)
FOOTBALL_DATA_TOKEN=          # football-data.org token (free tier: 10 req/min, no daily cap, WC2026 included)
```

Edge Functions use their own environment variables configured in the Supabase dashboard (service-role key injected automatically by the runtime).
