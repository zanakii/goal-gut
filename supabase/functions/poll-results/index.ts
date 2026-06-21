// supabase/functions/poll-results/index.ts
// ─────────────────────────────────────────────────────────────────────
// Live-results poller — the reliable replacement for fetch-results.js +
// the GitHub Actions cron (see specifications/_archive/
// reliable-live-results-pipeline.md).
//
// Triggered every minute (June/July) by pg_cron -> pg_net, which POSTs
// here with the shared `x-cron-secret` header. The function:
//   1. smart-skip: bail if there is nothing worth an API call (see below)
//   2. fetch football-data.org v4 for yesterday..today (UTC)
//   3. pair upstream -> our rows by the seeded fd_match_id (NOT names)
//   4. idempotent write of live/finished scores to `matches`
//   5. loudly warn on any match it can't pair, in either direction
//
// Late-correction re-poll (added 2026-06-21, ESP 5-0->4-0 KSA):
//   football-data.org can amend a FINISHED scoreline *after* full time
//   (a phantom/VAR goal removed; the ESP-KSA fix landed in their feed
//   ~hours later). The old query only watched scheduled/live rows, so the
//   instant we wrote `finished` the match dropped out of the poll forever
//   and the correction was missed. We now also re-poll terminal matches
//   (finished / pen-*) for REPOLL_WINDOW_MS after kickoff, rewriting only
//   the *score* — a terminal match is never reverted to `live` (it stops
//   showing Live the moment the API says FINISHED, and stays that way).
//
// API budget: the competition request is a single call covering the whole
//   day, so re-polling N terminal matches is free once we're already
//   calling for a live match. When the only thing in the window is a
//   recently-finished match (the late-night tail), we throttle the call to
//   a RECHECK_EVERY_MIN bucket so the 6 h tail costs ~12 calls/h, not 60.
//
// Secrets (set in Dashboard -> Edge Functions -> Secrets):
//   FOOTBALL_DATA_TOKEN  — football-data.org API token
//   CRON_SECRET          — shared secret; must match the pg_cron header
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected.
//
// Deployed with verify_jwt=false: this is not a user endpoint, it
// authenticates the caller via CRON_SECRET and writes with service role.
// ─────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FOOTBALL_DATA_TOKEN = Deno.env.get("FOOTBALL_DATA_TOKEN");
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Our terminal statuses — a match here is "over"; we may still correct its
// score for a while, but we never send it back to `live`.
const TERMINAL = ["finished", "pen-home", "pen-away"];
// How long after kickoff we keep re-polling a terminal match for a late
// upstream score correction. 6 h comfortably covers football-data.org's
// post-match record touches (the ESP-KSA correction surfaced ~2.5 h out).
const REPOLL_WINDOW_MS = 6 * 3600 * 1000;
// In the quiet tail (only terminal matches in the window, nothing live),
// throttle the API call to one every N minutes instead of every minute.
const RECHECK_EVERY_MIN = 5;

// ─── Status mapping ──────────────────────────────────────────────────
// football-data.org match -> { internalStatus, scoreA, scoreB, write }.
// Returns null for statuses we don't auto-write (CANCELLED / AWARDED).
function mapMatch(match: any) {
  const fd = match.status;
  const ft = match.score?.fullTime || {};
  const home = ft.home;
  const away = ft.away;

  if (fd === "SCHEDULED" || fd === "TIMED") {
    return { internalStatus: "scheduled", scoreA: null, scoreB: null, write: false };
  }
  if (fd === "IN_PLAY" || fd === "PAUSED" || fd === "EXTENDED" || fd === "SUSPENDED") {
    return { internalStatus: "live", scoreA: home ?? 0, scoreB: away ?? 0, write: true };
  }
  if (fd === "FINISHED") {
    const winner = match.score?.winner;
    const hasPens = match.score?.penalties?.home != null;
    if (hasPens) {
      const internalStatus = winner === "HOME_TEAM" ? "pen-home" : "pen-away";
      return { internalStatus, scoreA: home, scoreB: away, write: true };
    }
    return { internalStatus: "finished", scoreA: home, scoreB: away, write: true };
  }
  if (fd === "POSTPONED") {
    return { internalStatus: "scheduled", scoreA: null, scoreB: null, write: true };
  }
  if (fd === "CANCELLED" || fd === "AWARDED") return null;
  console.warn(`Unknown football-data.org status: ${fd}`);
  return null;
}

// Parse a DB `timestamp without time zone` (stored in UTC, no offset) into ms.
const utcMs = (ts: string) => new Date(ts + "Z").getTime();

async function poll() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const now = Date.now();

  // Wider than today's 00:00-23:59 UTC: handles late kickoffs straddling
  // midnight, plus any match currently live regardless of kickoff.
  const fromIso = new Date(now - 30 * 3600 * 1000).toISOString();
  const toIso = new Date(now + 24 * 3600 * 1000).toISOString();

  const { data: rows, error: pendErr } = await supabase
    .from("matches")
    .select("id, fd_match_id, team_a, team_b, score_a, score_b, status, kickoff, updated_at")
    .gte("kickoff", fromIso)
    .lt("kickoff", toIso)
    .in("status", ["scheduled", "live", ...TERMINAL]);
  if (pendErr) throw new Error(`Supabase pending query failed: ${pendErr.message}`);

  // A row is a candidate if it's still scheduled/live, OR it's terminal but
  // young enough that a late upstream correction is still plausible.
  const candidates = (rows ?? []).filter((p) => {
    if (p.status === "scheduled" || p.status === "live") return true;
    const age = now - utcMs(p.kickoff);
    return TERMINAL.includes(p.status) && age >= 0 && age <= REPOLL_WINDOW_MS;
  });

  if (candidates.length === 0) {
    console.log("No candidate matches in window. Skipping API call.");
    return { skipped: true };
  }

  // Smart-skip the API call. A live/scheduled match always warrants a poll.
  // A terminal-only window (the post-match tail) only polls on the recheck
  // bucket, so we don't spend a request every minute for hours just to
  // confirm an unchanged final score.
  const hasPendingLive = candidates.some((p) => p.status === "scheduled" || p.status === "live");
  const bucketDue = new Date(now).getUTCMinutes() % RECHECK_EVERY_MIN === 0;
  if (!hasPendingLive && !bucketDue) {
    console.log(`Only terminal matches in window; off recheck bucket (every ${RECHECK_EVERY_MIN}m). Skipping API call.`);
    return { skipped: true };
  }
  console.log(`${candidates.length} candidate match(es) in window (${hasPendingLive ? "live/scheduled present" : "terminal re-poll"}).`);

  const today = new Date(now).toISOString().split("T")[0];
  const yesterday = new Date(now - 24 * 3600 * 1000).toISOString().split("T")[0];
  const r = await fetch(
    `https://api.football-data.org/v4/competitions/WC/matches?dateFrom=${yesterday}&dateTo=${today}`,
    { headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN! } },
  );
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`football-data.org API ${r.status}: ${body}`);
  }
  const data = await r.json();
  const upstream: any[] = data.matches || [];
  console.log(`API requests remaining this minute: ${r.headers.get("x-requests-available-minute") ?? "n/a"}`);
  console.log(`Matches returned: ${upstream.length}`);

  let updated = 0, corrected = 0, unchanged = 0, unpairedUpstream = 0, unpairedDb = 0;

  // ── Upstream -> our rows, paired on fd_match_id ──
  for (const match of upstream) {
    const mapped = mapMatch(match);
    if (!mapped || !mapped.write) continue;

    const dbMatch = candidates.find((p) => p.fd_match_id === match.id);
    if (!dbMatch) {
      // Only a LIVE upstream fixture that won't pair is a real problem (a
      // seeded row that should be pending but wasn't found). Finished
      // upstream matches in the window legitimately aren't candidates — skip
      // them silently so the genuine signal isn't buried.
      if (mapped.internalStatus === "live") {
        console.warn(`  ⚠ LIVE upstream fixture ${match.id} (${match.homeTeam?.name} v ${match.awayTeam?.name}) not paired to any candidate row — fd_match_id seeded?`);
        unpairedUpstream++;
      }
      continue;
    }

    // Never revert a finalised match to live. Once we (or the API) have
    // declared it over, the re-poll window only ever amends the score; a
    // transient upstream IN_PLAY blip can't drag it back to "live".
    const dbTerminal = TERMINAL.includes(dbMatch.status);
    if (dbTerminal && mapped.internalStatus === "live") continue;

    if (
      dbMatch.score_a === mapped.scoreA &&
      dbMatch.score_b === mapped.scoreB &&
      dbMatch.status === mapped.internalStatus
    ) {
      unchanged++;
      continue;
    }

    const { error: patchErr } = await supabase
      .from("matches")
      .update({
        score_a: mapped.scoreA,
        score_b: mapped.scoreB,
        status: mapped.internalStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", dbMatch.id);
    if (patchErr) throw new Error(`Supabase update failed (id ${dbMatch.id}): ${patchErr.message}`);

    const sa = mapped.scoreA ?? "·";
    const sb = mapped.scoreB ?? "·";
    // A write to an already-terminal row is a post-full-time correction —
    // flag it distinctly so these stand out in the logs.
    const tag = dbTerminal ? "CORRECTION" : mapped.internalStatus;
    console.log(`  ✓ ${dbMatch.team_a} ${sa}-${sb} ${dbMatch.team_b} [${tag}] (id ${dbMatch.id})`);
    if (dbTerminal) corrected++; else updated++;
  }

  // ── Inverse miss: a scheduled/live match that has started but got NO
  // upstream fixture in the window. This is the warning that would have
  // surfaced the 2026-06-12 MEX-RSA date-window bug on the first run.
  // (Terminal candidates already have a result, so they're excluded.)
  const upstreamIds = new Set(upstream.map((m) => m.id));
  for (const p of candidates) {
    if (TERMINAL.includes(p.status)) continue;
    const started = p.status === "live" || utcMs(p.kickoff) <= now;
    if (started && (p.fd_match_id == null || !upstreamIds.has(p.fd_match_id))) {
      console.warn(`  ⚠ pending match ${p.id} (${p.team_a} v ${p.team_b}, KO ${p.kickoff}) started but has no upstream result (fd_match_id=${p.fd_match_id})`);
      unpairedDb++;
    }
  }

  const summary = { updated, corrected, unchanged, unpairedUpstream, unpairedDb };
  console.log(`Done. ${JSON.stringify(summary)}`);
  return summary;
}

Deno.serve(async (req) => {
  // Shared-secret gate: cron-only. The function writes with the service
  // role, so it must not be invokable by anyone with the public anon key.
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  if (!FOOTBALL_DATA_TOKEN) {
    return new Response("FOOTBALL_DATA_TOKEN not configured", { status: 500 });
  }
  try {
    const result = await poll();
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ERROR:", e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
