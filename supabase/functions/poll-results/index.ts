// supabase/functions/poll-results/index.ts
// ─────────────────────────────────────────────────────────────────────
// Live-results poller — the reliable replacement for fetch-results.js +
// the GitHub Actions cron (see specifications/_archive/
// reliable-live-results-pipeline.md).
//
// Triggered every minute (June/July) by pg_cron -> pg_net, which POSTs
// here with the shared `x-cron-secret` header. The function:
//   1. smart-skip: bail if no pending (scheduled/live) matches in window
//   2. fetch football-data.org v4 for yesterday..today (UTC)
//   3. pair upstream -> our rows by the seeded fd_match_id (NOT names)
//   4. idempotent write of live/finished scores to `matches`
//   5. loudly warn on any match it can't pair, in either direction
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

async function poll() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const now = Date.now();

  // Wider than today's 00:00-23:59 UTC: handles late kickoffs straddling
  // midnight, plus any match currently live regardless of kickoff.
  const fromIso = new Date(now - 30 * 3600 * 1000).toISOString();
  const toIso = new Date(now + 24 * 3600 * 1000).toISOString();

  const { data: pending, error: pendErr } = await supabase
    .from("matches")
    .select("id, fd_match_id, team_a, team_b, score_a, score_b, status, kickoff")
    .gte("kickoff", fromIso)
    .lt("kickoff", toIso)
    .in("status", ["scheduled", "live"]);
  if (pendErr) throw new Error(`Supabase pending query failed: ${pendErr.message}`);

  if (!pending || pending.length === 0) {
    console.log("No pending matches in window. Skipping API call.");
    return { skipped: true };
  }
  console.log(`${pending.length} pending match(es) in window.`);

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

  let updated = 0, unchanged = 0, unpairedUpstream = 0, unpairedDb = 0;

  // ── Upstream -> our rows, paired on fd_match_id ──
  for (const match of upstream) {
    const mapped = mapMatch(match);
    if (!mapped || !mapped.write) continue;

    const dbMatch = pending.find((p) => p.fd_match_id === match.id);
    if (!dbMatch) {
      // Only a LIVE upstream fixture that won't pair is a real problem (a
      // seeded row that should be pending but wasn't found). Finished
      // upstream matches in the window legitimately aren't pending — skip
      // them silently so the genuine signal isn't buried.
      if (mapped.internalStatus === "live") {
        console.warn(`  ⚠ LIVE upstream fixture ${match.id} (${match.homeTeam?.name} v ${match.awayTeam?.name}) not paired to any pending row — fd_match_id seeded?`);
        unpairedUpstream++;
      }
      continue;
    }

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
    console.log(`  ✓ ${dbMatch.team_a} ${sa}-${sb} ${dbMatch.team_b} [${mapped.internalStatus}] (id ${dbMatch.id})`);
    updated++;
  }

  // ── Inverse miss: a pending match that has started but got NO upstream
  // fixture in the window. This is the warning that would have surfaced
  // the 2026-06-12 MEX-RSA date-window bug on the first run.
  const upstreamIds = new Set(upstream.map((m) => m.id));
  for (const p of pending) {
    const started = p.status === "live" || new Date(p.kickoff + "Z").getTime() <= now;
    if (started && (p.fd_match_id == null || !upstreamIds.has(p.fd_match_id))) {
      console.warn(`  ⚠ pending match ${p.id} (${p.team_a} v ${p.team_b}, KO ${p.kickoff}) started but has no upstream result (fd_match_id=${p.fd_match_id})`);
      unpairedDb++;
    }
  }

  const summary = { updated, unchanged, unpairedUpstream, unpairedDb };
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
