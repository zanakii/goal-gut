# Live-results fetching

## Goal

Push live in-progress and final match scores into Supabase so the leaderboard updates **while** matches are being played, not just after the final whistle. Replaces the previous finished-only api-football.com integration.

## Provider

**football-data.org v4.** Free tier covers FIFA World Cup, allows 10 requests/minute with no daily cap. Auth via the `X-Auth-Token` header.

Base URL: `https://api.football-data.org/v4`
Competition code: `WC` (FIFA World Cup)

## Cadence and coverage

GitHub Actions cron (`.github/workflows/fetch-results.yml`) fires `node fetch-results.js` **every 2 minutes** during match hours, every day in **June and July 2026** — covering the group stage, every knockout round, and the final on July 19.

Two cron expressions split the daily window so the schedule is easy to scan:
- `*/2 16-23 * 6,7 *` — afternoon/evening kickoffs (UTC)
- `*/2 0-6 * 6,7 *` — overnight (covers AET / penalties on late kickoffs)

The repo is public so GitHub Actions minutes are unmetered. The poller itself is well within the upstream 10 req/min limit (1 request per fire, with a smart-skip that elides the call entirely on rest-day fires).

## Status state machine

`fetch-results.js` maps football-data.org's status to an internal vocabulary written to the `matches.status` column.

| Upstream status | Internal status | Writes scores? |
|---|---|---|
| SCHEDULED, TIMED | `scheduled` | only if currently null |
| IN_PLAY, PAUSED, EXTENDED, SUSPENDED | `live` | yes — always overwrite |
| FINISHED (no penalties) | `finished` | yes |
| FINISHED on penalties | `pen-home` or `pen-away` (from `score.winner`) | yes — writes the AET/120-min score |
| POSTPONED | `scheduled` (revert to null) | yes — nulls both |
| CANCELLED, AWARDED | none — log warning | no auto-write |

**Always overwrite while live.** VAR can disallow a goal that's already been written, so scores can decrement. `fetch-results.js` does not skip writes when `score_a` is already populated.

**Idempotency.** The script reads the current row's `score_a, score_b, status` in the smart-skip query and skips the PATCH when nothing changed. This prevents `updated_at` from bumping on every poll for matches that haven't moved.

## Frontend invariants

`index.html` distinguishes two predicates over a match:

- **`m.score_a !== null`** — "this match has a score to show". True for live and finished matches alike. Used for: leaderboard inclusion, played/upcoming filters, score-box rendering, score-trend chart.
- **`isFinal(m)`** — "this match is terminally settled". True only when `status` is in `{finished, pen-home, pen-away}`. Used for: `matchWinner(m)` (returns null for live matches, preventing premature elimination/advancement), `groupStageComplete` (only true once every group game is final, gating the bracket UI).

A small "AO VIVO" pill is shown on match cards and in match detail when `m.status === 'live'`.

The leaderboard fluctuating mid-match is the **desired** live experience — a player who picked the eventual final score will see their points improve as the match progresses toward it.

## Failure modes and runbook

- **VAR-disallowed goal.** Upstream score decrements. Our overwrite-always behavior reflects this on the next poll.
- **Match POSTPONED mid-tournament.** Status reverts to `scheduled` and scores null out. The Supabase row keeps its identity; predictions remain attached.
- **Match CANCELLED or AWARDED (e.g. forfeit).** No auto-write — surface manually via direct Supabase edit. Log warning in the Actions run.
- **Token compromise.** Rotate via football-data.org dashboard, update the `FOOTBALL_DATA_TOKEN` GitHub repo Secret, and update local `.env` if used.
- **Upstream outage.** Smart-skip means rest-day fires no-op anyway. During match hours, the next 2-min fire retries. No state to recover.
- **Team-name mismatch.** `team-map.js` carries multiple aliases per team. If a new variant appears upstream, add it to the map — no schema change needed.

## What this does NOT touch

The predictions tab and submission flow are entirely unaffected:
- `predictions`, `podium_predictions`, `bracket_predictions` tables — unchanged
- `submit-predictions`, `submit-bracket`, `change-pin` Edge Functions — unchanged
- `tournament_config.submission_deadline` and the deadline gate — unchanged
- PIN authentication flow — unchanged

The poller writes only to the `matches` table.

## Verification

1. **Token + base URL**: `node test-api.js` returns HTTP 200 and prints WC fixtures for 2026-06-11.
2. **Live path**: during an active match window, `node fetch-results.js` writes `status='live'` rows and updates score_a/score_b each run; subsequent runs report "unchanged" until score moves.
3. **Frontend invariants**: manually flip a group match to `status='live'` with a partial score in Supabase. Verify the leaderboard updates, the "AO VIVO" pill renders, and `groupStageComplete` stays false until the match flips to `finished`.
4. **Knockout safety**: flip a KO match to `status='live'` mid-game. Confirm `matchWinner(m)` returns null (no premature bracket advancement, no premature elimination set inclusion).
