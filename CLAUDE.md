# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Node.js utility scripts for seeding and exploring FIFA World Cup 2026 match data in a Supabase (PostgreSQL) database. There is no application server — only standalone scripts run directly with `node`.

## Running scripts

```bash
node seed-matches.js    # Insert all 72 group-stage matches into Supabase
node find-league.js     # Discover league IDs from api-sports.io
node test-api.js        # Test fixture fetch from api-sports.io (league 1, season 2026)
```

## External dependencies

- **Supabase (PostgreSQL)** — connection string hardcoded in `seed-matches.js` as `SUPABASE_URL`. The target table is `matches` with columns: `group_letter`, `team_a`, `team_b`, `kickoff`, `venue`, `status`.
- **API-Football** (`https://v3.football.api-sports.io`) — API key hardcoded as `API_KEY` in `find-league.js` and `test-api.js`. Rate limit remaining is logged on each call.

## Data notes

- All team names are in **Portuguese** (e.g., `Brasil`, `França`, `Países Baixos`).
- Match times are stored in **UTC**.
- Group G contains Iran as a placeholder — FIFA replacement decision was pending at time of writing.
- `seed-matches.js` uses `ON CONFLICT DO NOTHING`, so re-running is safe.
