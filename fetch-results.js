// fetch-results.js
// ─────────────────────────────────────────────────────────────────────
// HOW THIS WORKS:
//
// 1. This script runs on a schedule via GitHub Actions (every 2 min
//    during match hours, in June and July 2026 — covering the group
//    stage and the entire knockout bracket through the final).
//
// 2. It calls football-data.org v4:
//    GET /competitions/WC/matches?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
//    Returns all WC matches for today, with current status and scores.
//
// 3. It writes both LIVE and FINISHED scores to Supabase:
//    - IN_PLAY / PAUSED / EXTENDED / SUSPENDED → status 'live'
//    - FINISHED                                → status 'finished'
//    - FINISHED on penalties                   → status 'pen-home' / 'pen-away'
//    - POSTPONED                               → revert to 'scheduled' (null scores)
//    - CANCELLED / AWARDED                     → log warning, no auto-write
//
// 4. Smart-skip: if there are no pending (scheduled or live) matches
//    in the current window, skip the API call. Idempotent — only
//    PATCHes when score or status actually changed.
//
// SETUP (GitHub repo Secrets):
//   FOOTBALL_DATA_TOKEN = your football-data.org API token
//   SUPABASE_URL        = https://thjvoocszfzqkyatkevv.supabase.co
//   SUPABASE_KEY        = Supabase SERVICE ROLE key (NOT anon)
// ─────────────────────────────────────────────────────────────────────

const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const TEAM_MAP = require('./team-map');
function translateTeam(name) { return TEAM_MAP[name] || name; }

// ─── Status mapping ──────────────────────────────────────────────────
// Maps a football-data.org match → { internalStatus, scoreA, scoreB, write }.
// Returns null for statuses we shouldn't auto-write (CANCELLED / AWARDED).
function mapMatch(match) {
  const fd = match.status;
  const ft = match.score?.fullTime || {};
  const home = ft.home;
  const away = ft.away;

  if (fd === 'SCHEDULED' || fd === 'TIMED') {
    return { internalStatus: 'scheduled', scoreA: null, scoreB: null, write: false };
  }
  if (fd === 'IN_PLAY' || fd === 'PAUSED' || fd === 'EXTENDED' || fd === 'SUSPENDED') {
    return { internalStatus: 'live', scoreA: home ?? 0, scoreB: away ?? 0, write: true };
  }
  if (fd === 'FINISHED') {
    const winner = match.score?.winner;
    const hasPens = match.score?.penalties?.home != null;
    if (hasPens) {
      const internalStatus = winner === 'HOME_TEAM' ? 'pen-home' : 'pen-away';
      return { internalStatus, scoreA: home, scoreB: away, write: true };
    }
    return { internalStatus: 'finished', scoreA: home, scoreB: away, write: true };
  }
  if (fd === 'POSTPONED') {
    return { internalStatus: 'scheduled', scoreA: null, scoreB: null, write: true };
  }
  if (fd === 'CANCELLED' || fd === 'AWARDED') {
    return null;
  }
  console.warn(`Unknown football-data.org status: ${fd}`);
  return null;
}

// ─── Supabase ────────────────────────────────────────────────────────
async function supabasePatch(matchId, scoreA, scoreB, status) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/matches?id=eq.${matchId}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({
      score_a: scoreA,
      score_b: scoreB,
      status,
      updated_at: new Date().toISOString()
    })
  });
  if (!r.ok) throw new Error(`Supabase PATCH failed: ${r.status}`);
}

// Wider than today's 00:00-23:59 UTC: handles late kickoffs straddling
// midnight, plus any match that's currently live regardless of kickoff.
async function getPendingNow() {
  const now = new Date();
  const fromIso = new Date(now.getTime() - 30 * 3600 * 1000).toISOString();
  const toIso = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/matches?kickoff=gte.${fromIso}&kickoff=lt.${toIso}&status=in.(scheduled,live)&select=id,team_a,team_b,score_a,score_b,status`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!r.ok) throw new Error(`Supabase GET failed: ${r.status}`);
  return r.json();
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log(`[${new Date().toISOString()}] Checking for results...`);

  const pending = await getPendingNow();
  if (pending.length === 0) {
    console.log("No pending matches in window. Skipping API call.");
    return;
  }
  console.log(`${pending.length} pending match(es) in window.`);

  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().split("T")[0];
  const r = await fetch(
    `https://api.football-data.org/v4/competitions/WC/matches?dateFrom=${yesterday}&dateTo=${today}`,
    { headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN } }
  );
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`football-data.org API ${r.status}: ${body}`);
  }
  const data = await r.json();
  const remaining = r.headers.get('x-requests-available-minute');
  console.log(`API requests remaining this minute: ${remaining ?? 'n/a'}`);
  console.log(`Matches returned: ${data.matches?.length ?? 0}`);

  if (!data.matches || data.matches.length === 0) {
    console.log("No matches returned for today.");
    return;
  }

  let updated = 0, unchanged = 0;

  for (const match of data.matches) {
    const mapped = mapMatch(match);
    if (!mapped || !mapped.write) continue;

    const homeTeam = translateTeam(match.homeTeam.name);
    const awayTeam = translateTeam(match.awayTeam.name);

    const dbMatch = pending.find(p => p.team_a === homeTeam && p.team_b === awayTeam);
    if (!dbMatch) {
      console.log(`  ⚠ No DB match in window for ${homeTeam} vs ${awayTeam}`);
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

    await supabasePatch(dbMatch.id, mapped.scoreA, mapped.scoreB, mapped.internalStatus);
    const sa = mapped.scoreA ?? '·';
    const sb = mapped.scoreB ?? '·';
    console.log(`  ✓ ${homeTeam} ${sa}-${sb} ${awayTeam} [${mapped.internalStatus}] (id ${dbMatch.id})`);
    updated++;
  }

  console.log(`\nDone. Updated ${updated}, unchanged ${unchanged}.`);
}

main().catch(e => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
