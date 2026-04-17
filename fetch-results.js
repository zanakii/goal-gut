// fetch-results.js
// ─────────────────────────────────────────────────────────────────────
// HOW THIS WORKS:
//
// 1. This script runs on a schedule via GitHub Actions (every 10 min
//    during match hours, 5PM-7AM BST / 16:00-06:00 UTC in June 2026).
//
// 2. It calls the api-football.com API endpoint:
//    GET /fixtures?league=1&season=2026&date=YYYY-MM-DD
//    This returns ALL World Cup matches for today, with their current
//    status and scores. It costs 1 API request per call.
//
// 3. For any match with status "FT" (Full Time), "AET" (After Extra
//    Time), or "PEN" (Penalties), it takes the fulltime score and
//    updates the corresponding row in your Supabase matches table.
//
// 4. It uses the Supabase REST API with your service role key to
//    PATCH (update) the match rows. It matches on team names since
//    we don't have api-football fixture IDs stored.
//
// 5. The script is smart: it only calls the API if there are matches
//    today that don't have results yet. On rest days, it does nothing.
//
// SETUP:
//   - Add these as GitHub repository secrets:
//     API_FOOTBALL_KEY  = your api-football.com API key
//     SUPABASE_URL      = https://thjvoocszfzqkyatkevv.supabase.co
//     SUPABASE_KEY      = your Supabase SERVICE ROLE key (not anon!)
//                         Found in: Dashboard → Project Settings → API → service_role
//
//   - The service_role key is needed because we're writing data.
//     Unlike the anon key, this one should NEVER be in frontend code.
// ─────────────────────────────────────────────────────────────────────

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // service_role key

// ─── Team name mapping (api-football English → your Portuguese DB names) ───
const TEAM_MAP = require('./team-map');

function translateTeam(name) {
  return TEAM_MAP[name] || name;
}

// ─── Supabase helper ─────────────────────────────────────────────────
async function supabaseUpdate(matchId, scoreA, scoreB, status = "finished") {
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

async function getUnfinishedToday() {
  const today = new Date().toISOString().split("T")[0];
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/matches?kickoff=gte.${today}T00:00:00Z&kickoff=lt.${today}T23:59:59Z&status=eq.scheduled&select=id,team_a,team_b`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!r.ok) throw new Error(`Supabase GET failed: ${r.status}`);
  return r.json();
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log(`[${new Date().toISOString()}] Checking for results...`);

  // Step 1: Check if there are unfinished matches today in our DB
  const pending = await getUnfinishedToday();
  if (pending.length === 0) {
    console.log("No pending matches today. Skipping API call.");
    return;
  }
  console.log(`${pending.length} pending match(es) today.`);

  // Step 2: Fetch today's fixtures from api-football.com
  // This costs 1 API request out of our 100/day budget
  const today = new Date().toISOString().split("T")[0];
  const r = await fetch(
    `https://v3.football.api-sports.io/fixtures?league=1&season=2026&date=${today}`,
    { headers: { "x-apisports-key": API_FOOTBALL_KEY } }
  );
  const data = await r.json();
  const remaining = r.headers.get("x-ratelimit-requests-remaining");
  console.log(`API requests remaining today: ${remaining}`);
  console.log(`Fixtures returned: ${data.results || 0}`);

  if (!data.response || data.response.length === 0) {
    console.log("No fixtures returned from API.");
    return;
  }

  // Step 3: Check each fixture for finished status
  // api-football status codes for finished matches: FT, AET, PEN
  const finishedStatuses = ["FT", "AET", "PEN"];
  let updated = 0;

  for (const fixture of data.response) {
    const status = fixture.fixture.status.short;
    if (!finishedStatuses.includes(status)) continue;

    const homeTeam = translateTeam(fixture.teams.home.name);
    const awayTeam = translateTeam(fixture.teams.away.name);
    const scoreA = fixture.goals.home;
    const scoreB = fixture.goals.away;

    // For penalty shootouts, encode the winner in the status field.
    // fixture.goals stores the AET score (may be tied); penalty winner is separate.
    let finalStatus = "finished";
    if (status === "PEN") {
      const penHome = fixture.score?.penalty?.home ?? 0;
      const penAway = fixture.score?.penalty?.away ?? 0;
      finalStatus = penHome > penAway ? "pen-home" : "pen-away";
    }

    // Find the matching pending match in our DB
    const match = pending.find(m => m.team_a === homeTeam && m.team_b === awayTeam);
    if (!match) {
      console.log(`  ⚠ No DB match found for ${homeTeam} vs ${awayTeam} — team name mismatch?`);
      continue;
    }

    // Step 4: Update the score in Supabase
    await supabaseUpdate(match.id, scoreA, scoreB, finalStatus);
    console.log(`  ✓ Updated: ${homeTeam} ${scoreA}-${scoreB} ${awayTeam} [${finalStatus}] (match ${match.id})`);
    updated++;
  }

  console.log(`\nDone. Updated ${updated} match(es). ${pending.length - updated} still pending.`);
}

main().catch(e => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
