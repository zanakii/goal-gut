# Runbook: stand up the next World Cup edition

**Audience:** whoever revives this codebase for WC 2030 / 2034 (same FIFA 48-team, 12-group format).
**Premise:** this fork only ever runs World Cups. The bracket structure is a **format invariant** — you re-point *data*, never *structure*. If you find yourself editing the bracket tree or the scoring, stop: you're either looking at a FIFA format change (rare — see step 8) or you're in the wrong runbook.

Estimated effort: **half a day**, almost all of it re-typing the schedule.

> **Start here.** `index.html` opens with a **`TOURNAMENT CONFIG` fork manifest** (right after the Supabase keys) that names every edition/format-variant symbol referenced below. This runbook cites symbols, not line numbers, so nothing here goes stale as the file grows — search the file for the symbol name.

---

## What you do NOT touch (WC format invariants)

Leave every one of these exactly as-is. They are permanent properties of the 48-team World Cup and are already correct:

- The static bracket tree — the `R32` / `R16` / `QF` / `SF` arrays and `BRACKET_STRUCTURE`, groups A–L.
- The group-stage shape: `GROUP_MATCH_COUNT` (72, the group-complete threshold — a single named constant in the fork manifest), `isGroupMatch` (tests `group_letter` against `/^[A-L]$/`) as the group/KO discriminator, and 4 teams per group.
- Third-place match (`3P`), the SF/final carve-outs, and all of `computeActualTournamentState`.
- The structural-podium-floor geometry — 4 quarters of 8, `PODIUM_QUARTERS = [[0,1,2,4],…]` (see `specifications/_archive/structural-podium-floor.md`). Permanently correct.
- Podium-elimination logic (`specifications/_archive/podium-elimination-and-scoring.md`).
- All scoring: `calcPts`, `calcPodiumPts`, `calcPodiumSlotPts`, and the `badgeColor` thresholds. Golf scale, tournament-agnostic.
- The ranking layer: `compareStandings` / `sameRank` and the canonical tie-break ladder (`specifications/_archive/one-rank-authority-canonical-tiebreak-ladder.md`).
- The live-results mechanism: `poll-results` Edge Function, pairing on `fd_match_id`. Only its inputs change (below).

---

## The checklist

### 1. Decide: fresh Supabase project vs. reset in place
Recommended: **spin a new Supabase project** so the prior edition stays intact as an archive (Vercel just re-points). Alternative: truncate `matches`, `predictions`, `podium_predictions`, `bracket_predictions`, `players`, and clear `tournament_config` rows. Either way the schema is unchanged — no migration.

### 2. Roster + name map — `team-map.js`
Add/remove nations so every qualified team has a football-data-English → Portuguese entry. Keep multiple aliases per team — the API spells some teams differently across endpoints (the file documents the `Cape Verde Islands` / `Côte d'Ivoire` cases). 48 teams; the current file has ~26 base entries plus aliases.

### 3. Group schedule — `seed-matches.js` → `node seed-matches.js`
Rebuild the `MATCHES` array: all 72 group fixtures as `{ group:'A'..'L', teamA, teamB (Portuguese, matching team-map output), date (UTC ISO), venue }`. Reads `SUPABASE_CONNECTION_STRING` (direct `pg`). This is the bulk of the work.

### 4. ⚠️ The one structural-ish variable: host timezone
Different host → different local kickoff clock → the "game day" rollover shifts. 2026 is North America; 2030 is Iberia/Morocco (WEST/CET). Update:
- `GAME_DAY_ROLLOVER_UTC_HOUR` — set to the UTC hour matching **09:00 local** in the host zone (2026: WEST → `8`).
- The `pg_cron` month gate (the poller runs "every minute, June/July"). If the edition spans different months, re-`cron.schedule` accordingly.
This is the *only* constant that legitimately changes between World Cups. Everything else in this step-list is data.

### 5. Pair `fd_match_id` for the group rows — `node seed-fd-ids.js`
Dumps the full football-data WC fixture list (`fd_id | utcDate | status | Home v Away`). Eyeball the kickoff/team correspondence and write `fd_match_id` onto each `matches` row (paired by kickoff == utcDate, **not** by translated name — that's the whole point of the manual step). Without this the poller can't pair and no scores land.

### 6. tournament_config + players
- `tournament_config`: set `submission_deadline` and `reveal_at`; ensure `actual_podium` is cleared. (`loadData` reads these keys.)
- Seed the pool: manually add `players` rows + PINs (no self-registration in v0).

### 7. Live pipeline + secrets
Confirm `poll-results` is deployed (`supabase functions deploy poll-results`) and Edge secrets are set: `FOOTBALL_DATA_TOKEN`, `CRON_SECRET` (latter also in Vault as `poll_results_cron_secret`). The football-data competition code stays **`WC`** — only the season rolls, so the fetch URL is unchanged. Confirm the `pg_cron` job POSTs with the `x-cron-secret` header.

### 8. Sanity-check the bracket tree against the regs (rare patch)
FIFA finalised the 2026 R32 third-placed-team assignment late. Before the knockouts, confirm the official R32 placement still matches the static `R32` array. If FIFA tweaked it, patch those slot definitions — a **data patch to the tree**, not an architecture change.

### 9. Knockouts (during the tournament) — `node seed-knockout.js`
After the group stage, run it once per round as matchups confirm. It lands KO rows (stage codes `R32`→`FIN`, the Final being `FIN` **not** `F`) with `fd_match_id` already set, so the poller scores them and the structural floor / elimination light up automatically. Re-run `seed-fd-ids.js` if any KO row needs manual pairing.

### 10. Copy + deploy
Find/replace edition strings (`WC2026`, year, host references) in `index.html` and `ROADMAP.md`. Then deploy and **verify live** — a push to `main` ≠ a live deploy (Vercel git-integration auth can lapse silently). `curl -sL https://goalgut.gg/ | grep -c <new-edition-string>`; if stale, `npx vercel --prod` and fix the dashboard Git auth.

---

## One-line summary
New roster, new 72-match schedule, new host-timezone constant, fresh pool, re-point the feed season — then let the invariant bracket do its job.
