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

**Goal Gut** — a private World Cup 2026 predictions pool for a closed group of friends, live at [goalgut.gg](https://goalgut.gg). Group stage starts June 2026, final July 19. Scoring is golf-style — lower = better, exact = 0.

This is the **v0** edition — deliberately simple, single-pool. Do not refactor toward a framework or introduce auth libraries; the **public edition** is a separate rebuild in a sibling `goalgut/` repo.

## Stack & infra

- `index.html` — entire frontend (vanilla JS + CSS, no framework, no build step)
- Supabase — PostgreSQL + Edge Functions (project `thjvoocszfzqkyatkevv`, region `eu-west-1`)
- Vercel — static hosting, auto-deploys from `main`
- GitHub Actions — `fetch-results.yml`, every 2 min during match hours, June–July 2026

GitHub Secrets: `FOOTBALL_DATA_TOKEN`, `SUPABASE_URL`, `SUPABASE_KEY` (service role).

## Gotchas

- **A `git push` to `main` does NOT guarantee a live deploy.** Vercel auto-deploys from `main` via the GitHub integration, but that integration's auth can silently lapse (it did on 2026-06-06 — a stale token stranded two commits un-deployed while pushes kept succeeding). After pushing user-facing changes, **verify the live site actually updated** — `curl -sL https://goalgut.gg/ | grep -c <a-string-unique-to-your-change>` (the apex 307-redirects to `www.goalgut.gg`, so use `-L`). If it's stale, deploy manually: `npx vercel --prod` (needs `vercel login` + `vercel link` to the `goal-gut` project first). Then fix the root cause in the Vercel dashboard → Settings → Git.
- **Edge Functions are NOT auto-deployed.** After editing `supabase/functions/<name>/`, run `supabase functions deploy <name>`.
- **All team names are in Portuguese** (`Brasil`, `Países Baixos`, etc.). `team-map.js` maps football-data.org English names to the DB form.
- **Bracket picks (`bracket_predictions`) do not score independently.** The knockout bracket is a UX device for drafting the path to the 1-2-3 podium pick — that's what `calcPodiumPts` scores.
- **Scoring lives in `calcPts` / `calcPodiumPts` / `calcPodiumSlotPts` in `index.html`.** Single source of truth — do not duplicate; `badgeColor` thresholds are calibrated to this scale.
- **Score-display invariant:** `m.score_a !== null` means "show this score"; `isFinal(m)` means "match is over — lock bracket/elimination logic on it".
- **PIN verification is server-side** in Edge Functions; anon key never sees PINs. RLS on prediction tables is gated on `tournament_config.submission_deadline` — direct anon reads return empty pre-deadline.

## Discover schema & code from source

- Tables/columns → `mcp__supabase__list_tables`
- Edge Functions → `ls supabase/functions/` + each `index.ts` header comment
- Node scripts → `ls *.js`; each has a header comment
- Status vocabulary, tab names, function signatures → `grep` the code
