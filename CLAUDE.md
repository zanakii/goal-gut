# CLAUDE.md

Guidance for Claude Code working in this repository.

## Verify before recall

Before claiming any work is pending, in-flight, or unresolved based on a memory entry, verify against current code and `git log`. Memory is a hint about where to look, never a source of truth.

## Working defaults

- **`.env` files are off-limits.** A global PreToolUse hook blocks Read/Bash on `.env*` (except `.env.example`). If you need a value, name the variable, explain why, and ask the user to report it back.
- **Archive specs in the same commit that ships them.** When committing a feature whose spec lives in `specifications/`, move it to `specifications/_archive/`. Top level holds only active/in-flight specs.
- **Run advisors after Supabase migrations.** After any `mcp__supabase__apply_migration` (or DDL `execute_sql`), call `mcp__supabase__get_advisors` for security and performance; surface findings before declaring done.
- **Verify mutating scripts before running them.** Read the actual SQL — don't trust "safe to re-run" notes. A project hook auto-snapshots the DB before/after known mutation commands and emits the diff; treat it as a backstop, not a substitute for understanding the script.
- **Clean up after a merged PR.** Once a feature PR lands on `main` (e.g. `dev → main`), fast-forward local `main` (`git checkout main && git pull origin main`) and delete the merged feature branch locally (`git branch -d <branch>`; the GitHub "delete branch on merge" already removes the remote). Vercel deploys from `main`, so the merge is what actually ships to goalgut.gg — confirm the merge before declaring done. (This is a convention, not a hook — there's no harness event for "PR merged.")

## Project

**Goal Gut** — a private World Cup 2026 predictions pool for a closed group of friends, live at [goalgut.gg](https://goalgut.gg). Scoring is golf-style — lower = better, exact = 0. **The WC2026 edition is complete** (group stage June 2026, final 2026-07-19 — Espanha champion, Pedro Miguel won the pool); the code is now in a port-ready state for the next edition.

This is the **v0** edition — deliberately simple, single-pool. Do not refactor toward a framework or introduce auth libraries; the **public edition** is a separate rebuild in a sibling `goalgut/` repo.

**Forking to the next edition (start here).** Everything edition- or format-specific lives in ONE `TOURNAMENT CONFIG` block at the top of `index.html` — `FLAGS`, the bracket tree (`R32`/`R16`/`QF`/`SF`/`BRACKET_STRUCTURE`), `PODIUM_QUARTERS`, `THIRD_SLOT_GROUPS`, `GROUP_MATCH_COUNT` (`isGroupMatch` is the one variant that stays a helper). Step-by-step runbooks live in `porting/`: `WC-reseed-runbook.md` (another World Cup — re-point data, never structure) and `EURO-fork-runbook.md` (Euro: 24-team, 6-group, no third-place match — a product decision gates the podium rewrite). The scoring / bracket-resolution / ranking engines are **format-invariant — do not touch them to fork.**

## Stack & infra

- `index.html` — entire frontend (vanilla JS + CSS, no framework, no build step)
- Supabase — PostgreSQL + Edge Functions (project `thjvoocszfzqkyatkevv`, region `eu-west-1`)
- Vercel — static hosting, auto-deploys from `main`
- Live results — Supabase `pg_cron` (every minute, June/July) → `pg_net` → the `poll-results` Edge Function, pairing on the seeded `matches.fd_match_id`. Replaced the GitHub Actions `fetch-results.yml` poller (removed 2026-06-15; see `_archive/reliable-live-results-pipeline.md`).

Edge Function secrets (Dashboard → Edge Functions → Secrets): `FOOTBALL_DATA_TOKEN`, `CRON_SECRET` (the latter also stored in Vault as `poll_results_cron_secret`, sent by the cron job as the `x-cron-secret` header). `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are auto-injected.

## Gotchas

- **A `git push` to `main` does NOT guarantee a live deploy.** Vercel auto-deploys from `main` via the GitHub integration, but that integration's auth can silently lapse (it did on 2026-06-06 — a stale token stranded two commits un-deployed while pushes kept succeeding). After pushing user-facing changes, **verify the live site actually updated** — `curl -sL https://goalgut.gg/ | grep -c <a-string-unique-to-your-change>` (the apex 307-redirects to `www.goalgut.gg`, so use `-L`). If it's stale, deploy manually: `npx vercel --prod` (needs `vercel login` + `vercel link` to the `goal-gut` project first). Then fix the root cause in the Vercel dashboard → Settings → Git.
- **Edge Functions are NOT auto-deployed.** After editing `supabase/functions/<name>/`, run `supabase functions deploy <name>` (or deploy via the Supabase MCP — the CLI isn't installed locally).
- **The live-results poller is `poll-results`, paired by id not name.** It matches upstream fixtures to our rows on `matches.fd_match_id`. **All 104 fixtures (incl. every knockout slot) are seeded once with their stable `fd_match_id`**; knockout rows start with `team_a`/`team_b` NULL ("matchup TBD") and the poller fills them in (translated to Portuguese) as the bracket resolves — so there is NO per-round manual re-seeding. The poller fetches the whole competition each run and treats any null-team row as a candidate. It is cron-only — invoke manually with `curl -H 'x-cron-secret: <CRON_SECRET>' <fn-url>`. Pause/resume with `select cron.unschedule('poll-results')` / re-`cron.schedule`. **Currently UNSCHEDULED** (2026-08-10, post-tournament): the schedule was `* * * 6,7 *`, and cron has no year field — it would have re-armed on 2027-06-01 and polled a finished competition every minute for two months. Re-schedule it as the last step of a reseed/fork, not before.

- **Archive mode.** `tournamentConcluded()` (true once the `FIN` row is final) puts the leaderboard into a dormant state: no position arrows, no Resumo, no Contas, and the progress bar is replaced by `conclusionCard` (champion / winner / who paid, all derived). Add any new "since last time" or "still to come" surface to this gate — a dormant board that still moves reads as live.
- **All team names are in Portuguese** (`Brasil`, `Países Baixos`, etc.). `team-map.js` maps football-data.org English names to the DB form (used by `seed-knockout.js`); the same map is inlined in `poll-results/index.ts`, which translates knockout team names as it fills them in.
- **Knockout stage codes live in `matches.group_letter`** (widened to `text`): `R32 R16 QF SF 3P FIN`. Group rows are single letters `A–L`; the Final is **`FIN`, never `F`** (`F` is Group F). Use the `isGroupMatch(m)` helper (tests `/^[A-L]$/`) — never `group_letter.length`.
- **Bracket picks (`bracket_predictions`) do not score independently.** The knockout bracket is a UX device for drafting the path to the 1-2-3 podium pick — that's what `calcPodiumPts` scores.
- **Scoring lives in `calcPts` / `calcPodiumPts` / `calcPodiumSlotPts` in `index.html`.** Single source of truth — do not duplicate; `badgeColor` thresholds are calibrated to this scale.
- **Ranking/ordering is ONE authority: `compareStandings` (display order) + `sameRank` (rank number, medal, dinner side).** Every rank-semantic surface — the leaderboard, the possible-rank range, Contas, the chart dinner bands — must go through them; `contasCmp` is `sameRank`'s strict prefix by design. Rank keys are `total → correct champion (2-way) → group points`; everything below (champion alive-vs-dead, podium exposure, exacts, alphabetical) is **display-only and must never move a position**. See `specifications/_archive/one-rank-authority-canonical-tiebreak-ladder.md`. Do not reintroduce a divergent comparator (that bug cost two prior rounds of fixes).
- **Score-display invariant:** `m.score_a !== null` means "show this score"; `isFinal(m)` means "match is over — lock bracket/elimination logic on it".
- **PIN verification is server-side** in Edge Functions; anon key never sees PINs. RLS on prediction tables is gated on `tournament_config.submission_deadline` — direct anon reads return empty pre-deadline.

## Discover schema & code from source

- Tables/columns → `mcp__supabase__list_tables`
- Edge Functions → `ls supabase/functions/` + each `index.ts` header comment
- Node scripts → `ls *.js`; each has a header comment
- Status vocabulary, tab names, function signatures → `grep` the code
