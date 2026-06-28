// supabase/functions/poll-results/index.ts
// ─────────────────────────────────────────────────────────────────────
// Live-results poller — the reliable replacement for fetch-results.js +
// the GitHub Actions cron (see specifications/_archive/
// reliable-live-results-pipeline.md).
//
// Triggered every minute (June/July) by pg_cron -> pg_net, which POSTs
// here with the shared `x-cron-secret` header. The function:
//   1. smart-skip: bail if there is nothing worth an API call (see below)
//   2. fetch the FULL competition from football-data.org v4
//   3. pair upstream -> our rows by the seeded fd_match_id (NOT names)
//   4. idempotent write of scores AND newly-resolved knockout matchups
//   5. loudly warn on any match it can't pair, in either direction
//
// Knockout auto-fill (added 2026-06-28): every knockout slot is seeded ONCE
//   up front (R32…FIN) with its stable fd_match_id but TBD teams. The bracket
//   is fixed, so as each round decides the next round's pairings, football-data
//   fills in homeTeam/awayTeam and this poller writes team_a/team_b (translated
//   to the Portuguese DB names) + the confirmed kickoff. No more manual
//   per-round re-seeding. We therefore fetch the whole competition (not a
//   date window) so a just-decided future fixture is visible immediately, and
//   we treat any row with a null team_a as a candidate regardless of kickoff.
//
// Late-correction re-poll (added 2026-06-21, ESP 5-0->4-0 KSA):
//   football-data.org can amend a FINISHED scoreline *after* full time. We
//   re-poll terminal matches (finished / pen-*) for REPOLL_WINDOW_MS after
//   kickoff, rewriting only the *score* — a terminal match is never reverted
//   to `live`.
//
// API budget: one competition request per poll covers everything. The
//   smart-skip keeps the quiet tail / between-rounds idle to one call per
//   RECHECK_EVERY_MIN bucket rather than every minute.
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
// upstream score correction.
const REPOLL_WINDOW_MS = 6 * 3600 * 1000;
// In the quiet tail / between knockout rounds, throttle the API call to one
// every N minutes instead of every minute.
const RECHECK_EVERY_MIN = 5;

const SELECT_COLS =
  "id, fd_match_id, team_a, team_b, score_a, score_b, status, kickoff, updated_at";

// football-data.org English name -> Portuguese DB name. Mirrors team-map.js;
// inlined because edge functions can't require() the CommonJS module. Only
// needed to write knockout matchups as they resolve (scores pair by id).
const TEAM_MAP: Record<string, string> = {
  "Mexico": "México",
  "South Korea": "Coreia do Sul", "Korea Republic": "Coreia do Sul",
  "South Africa": "África do Sul",
  "Czech Republic": "Rep. Checa", "Czechia": "Rep. Checa",
  "Canada": "Canadá", "Switzerland": "Suíça", "Qatar": "Qatar",
  "Bosnia And Herzegovina": "Bósnia-Herzegovina", "Bosnia Herzegovina": "Bósnia-Herzegovina", "Bosnia-Herzegovina": "Bósnia-Herzegovina",
  "Brazil": "Brasil", "Morocco": "Marrocos", "Scotland": "Escócia", "Haiti": "Haiti",
  "USA": "EUA", "United States": "EUA", "Australia": "Austrália",
  "Paraguay": "Paraguai",
  "Turkey": "Turquia", "Turkiye": "Turquia", "Türkiye": "Turquia",
  "Germany": "Alemanha", "Ecuador": "Equador",
  "Ivory Coast": "Costa do Marfim", "Cote D Ivoire": "Costa do Marfim", "Côte d'Ivoire": "Costa do Marfim",
  "Curacao": "Curaçau", "Curaçao": "Curaçau",
  "Netherlands": "Países Baixos", "Japan": "Japão", "Tunisia": "Tunísia",
  "Sweden": "Suécia", "Belgium": "Bélgica",
  "Iran": "Irão", "IR Iran": "Irão",
  "Egypt": "Egito",
  "New Zealand": "Nova Zelândia", "Spain": "Espanha", "Uruguay": "Uruguai",
  "Saudi Arabia": "Arábia Saudita",
  "Cape Verde": "Cabo Verde", "Cape Verde Islands": "Cabo Verde",
  "France": "França", "Senegal": "Senegal", "Norway": "Noruega", "Iraq": "Iraque",
  "Argentina": "Argentina", "Austria": "Áustria", "Algeria": "Argélia", "Jordan": "Jordânia",
  "Portugal": "Portugal", "Colombia": "Colômbia", "Uzbekistan": "Uzbequistão",
  "DR Congo": "RD Congo", "Congo DR": "RD Congo",
  "England": "Inglaterra", "Croatia": "Croácia", "Panama": "Panamá", "Ghana": "Gana",
};
function tname(name: string): string {
  const mapped = TEAM_MAP[name];
  if (!mapped) console.warn(`  ⚠ no team-map entry for upstream name "${name}" — storing as-is`);
  return mapped ?? name;
}

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
// Upstream utcDate ("2026-07-04T21:00:00Z") -> our stored form ("2026-07-04 21:00:00").
const koFromUtcDate = (utcDate: string) => utcDate.replace("T", " ").replace("Z", "");
// Compare kickoff at minute precision, tolerating T/space and trailing seconds.
const koMinute = (s: string) => String(s).replace("T", " ").slice(0, 16);

async function poll() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const now = Date.now();

  // Wider than today's window: handles late kickoffs straddling midnight plus
  // any currently-live match regardless of kickoff.
  const fromIso = new Date(now - 30 * 3600 * 1000).toISOString();
  const toIso = new Date(now + 24 * 3600 * 1000).toISOString();

  // (a) rows in the live/recent window — for scores & corrections.
  const { data: windowRows, error: pendErr } = await supabase
    .from("matches")
    .select(SELECT_COLS)
    .gte("kickoff", fromIso)
    .lt("kickoff", toIso)
    .in("status", ["scheduled", "live", ...TERMINAL]);
  if (pendErr) throw new Error(`Supabase pending query failed: ${pendErr.message}`);

  // (b) unresolved knockout rows (teams still TBD) — fill them the moment the
  // upstream matchup is decided, however far off their kickoff is.
  const { data: tbdRows, error: tbdErr } = await supabase
    .from("matches")
    .select(SELECT_COLS)
    .is("team_a", null);
  if (tbdErr) throw new Error(`Supabase TBD query failed: ${tbdErr.message}`);

  const byId = new Map<number, any>();
  for (const r of [...(windowRows ?? []), ...(tbdRows ?? [])]) byId.set(r.id, r);
  const allRows = [...byId.values()];

  // A row is a candidate if: its matchup is unresolved (needs a team fill), or
  // it's still scheduled/live, or it's terminal but young enough for a late
  // upstream score correction.
  const candidates = allRows.filter((p) => {
    if (p.team_a == null) return true;
    if (p.status === "scheduled" || p.status === "live") return true;
    const age = now - utcMs(p.kickoff);
    return TERMINAL.includes(p.status) && age >= 0 && age <= REPOLL_WINDOW_MS;
  });

  if (candidates.length === 0) {
    console.log("No candidate matches. Skipping API call.");
    return { skipped: true };
  }

  // Smart-skip. A near-term scheduled/live match warrants a poll every minute.
  // Everything else (terminal tail, far-off TBD knockout rows) only polls on
  // the recheck bucket.
  const hasPendingLive = candidates.some(
    (p) => p.team_a != null && (p.status === "scheduled" || p.status === "live"),
  );
  const bucketDue = new Date(now).getUTCMinutes() % RECHECK_EVERY_MIN === 0;
  if (!hasPendingLive && !bucketDue) {
    console.log(`No live/scheduled match due; off recheck bucket (every ${RECHECK_EVERY_MIN}m). Skipping API call.`);
    return { skipped: true };
  }
  console.log(`${candidates.length} candidate match(es) (${hasPendingLive ? "live/scheduled present" : "terminal/TBD recheck"}).`);

  const r = await fetch(
    "https://api.football-data.org/v4/competitions/WC/matches",
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

  let updated = 0, corrected = 0, resolved = 0, unchanged = 0, unpairedUpstream = 0, unpairedDb = 0;

  // ── Upstream -> our rows, paired on fd_match_id ──
  for (const match of upstream) {
    const dbMatch = candidates.find((p) => p.fd_match_id === match.id);
    if (!dbMatch) {
      // Only a LIVE upstream fixture that won't pair is a real problem.
      const mapped = mapMatch(match);
      if (mapped?.internalStatus === "live") {
        console.warn(`  ⚠ LIVE upstream fixture ${match.id} (${match.homeTeam?.name} v ${match.awayTeam?.name}) not paired to any candidate row — fd_match_id seeded?`);
        unpairedUpstream++;
      }
      continue;
    }

    const patch: Record<string, unknown> = {};

    // 1. Knockout matchup / kickoff resolution. Upstream homeTeam/awayTeam are
    // null while a slot is TBD; once decided we translate and store them. Only
    // touch kickoff on non-terminal rows (never rewrite a finished game's time).
    const home = match.homeTeam?.name ? tname(match.homeTeam.name) : null;
    const away = match.awayTeam?.name ? tname(match.awayTeam.name) : null;
    if (home && home !== dbMatch.team_a) patch.team_a = home;
    if (away && away !== dbMatch.team_b) patch.team_b = away;
    if (
      !TERMINAL.includes(dbMatch.status) &&
      match.utcDate &&
      koMinute(match.utcDate) !== koMinute(dbMatch.kickoff)
    ) {
      patch.kickoff = koFromUtcDate(match.utcDate);
    }
    const isTeamFill = patch.team_a != null || patch.team_b != null;

    // 2. Score / status (unchanged logic). Never revert a terminal row to live.
    const mapped = mapMatch(match);
    if (mapped && mapped.write) {
      const dbTerminal = TERMINAL.includes(dbMatch.status);
      if (!(dbTerminal && mapped.internalStatus === "live")) {
        if (!(dbMatch.score_a === mapped.scoreA && dbMatch.score_b === mapped.scoreB && dbMatch.status === mapped.internalStatus)) {
          patch.score_a = mapped.scoreA;
          patch.score_b = mapped.scoreB;
          patch.status = mapped.internalStatus;
        }
      }
    }

    if (Object.keys(patch).length === 0) {
      unchanged++;
      continue;
    }

    patch.updated_at = new Date().toISOString();
    const { error: patchErr } = await supabase.from("matches").update(patch).eq("id", dbMatch.id);
    if (patchErr) throw new Error(`Supabase update failed (id ${dbMatch.id}): ${patchErr.message}`);

    const teamA = (patch.team_a ?? dbMatch.team_a) as string;
    const teamB = (patch.team_b ?? dbMatch.team_b) as string;
    const dbTerminal = TERMINAL.includes(dbMatch.status);
    if (patch.status != null || patch.score_a != null) {
      const sa = (patch.score_a ?? dbMatch.score_a) ?? "·";
      const sb = (patch.score_b ?? dbMatch.score_b) ?? "·";
      const tag = dbTerminal ? "CORRECTION" : (patch.status ?? dbMatch.status);
      console.log(`  ✓ ${teamA} ${sa}-${sb} ${teamB} [${tag}] (id ${dbMatch.id})`);
      if (dbTerminal) corrected++; else updated++;
    } else if (isTeamFill) {
      console.log(`  ↳ resolved matchup: ${teamA} v ${teamB} (id ${dbMatch.id})`);
      resolved++;
    } else {
      // kickoff-only touch
      updated++;
    }
  }

  // ── Inverse miss: a scheduled/live match that has started but got NO upstream
  // fixture. (Terminal & still-TBD-future candidates are excluded.)
  const upstreamIds = new Set(upstream.map((m) => m.id));
  for (const p of candidates) {
    if (TERMINAL.includes(p.status) || p.team_a == null) continue;
    const started = p.status === "live" || utcMs(p.kickoff) <= now;
    if (started && (p.fd_match_id == null || !upstreamIds.has(p.fd_match_id))) {
      console.warn(`  ⚠ pending match ${p.id} (${p.team_a} v ${p.team_b}, KO ${p.kickoff}) started but has no upstream result (fd_match_id=${p.fd_match_id})`);
      unpairedDb++;
    }
  }

  const summary = { updated, corrected, resolved, unchanged, unpairedUpstream, unpairedDb };
  console.log(`Done. ${JSON.stringify(summary)}`);
  return summary;
}

Deno.serve(async (req) => {
  // Shared-secret gate: cron-only. The function writes with the service role,
  // so it must not be invokable by anyone with the public anon key.
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
