// seed-knockout.js
// ─────────────────────────────────────────────────────────────────────
// Run once after the group stage ends, once FIFA confirms all R32 matchups.
// Fetches knockout fixtures from api-football.com and seeds them into Supabase.
// The existing fetch-results.js workflow will then automatically update
// scores as each knockout match is played.
//
// Usage:
//   API_FOOTBALL_KEY=xxx SUPABASE_URL=https://... SUPABASE_KEY=xxx node seed-knockout.js
//
// Safe to re-run: skips matches that already exist (team_a + team_b + group_letter).
// ─────────────────────────────────────────────────────────────────────

const API_KEY = process.env.API_FOOTBALL_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const API_BASE = "https://v3.football.api-sports.io";

// Maps api-football round names → internal stage codes used as group_letter
const ROUND_TO_STAGE = {
  "Round of 32":    "R32",
  "Round of 16":    "R16",
  "Quarter-finals": "QF",
  "Semi-finals":    "SF",
  "3rd Place Final":"3P",
  "Final":          "F"
};

// Same team name translation as fetch-results.js
const TEAM_MAP = require('./team-map');

function t(name) { return TEAM_MAP[name] || name; }

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  if (!r.ok) throw new Error(`GET ${path}: ${r.status}`);
  return r.json();
}

async function sbInsert(row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/matches`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(row)
  });
  if (!r.ok) throw new Error(`INSERT failed: ${r.status} ${await r.text()}`);
}

async function main() {
  if (!API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing env vars: API_FOOTBALL_KEY, SUPABASE_URL, SUPABASE_KEY");
    process.exit(1);
  }

  console.log("Fetching all fixtures from api-football.com...");
  const r = await fetch(`${API_BASE}/fixtures?league=1&season=2026`, {
    headers: { "x-apisports-key": API_KEY }
  });
  const data = await r.json();
  console.log(`API requests remaining today: ${r.headers.get("x-ratelimit-requests-remaining")}`);
  console.log(`Total fixtures returned: ${data.results || 0}`);

  const koFixtures = (data.response || []).filter(f => ROUND_TO_STAGE[f.league.round]);
  const ready = koFixtures.filter(f => {
    const home = f.teams.home.name;
    const away = f.teams.away.name;
    return home && away && home !== "TBD" && away !== "TBD";
  });

  console.log(`Knockout fixtures: ${koFixtures.length} total, ${ready.length} with confirmed teams\n`);

  if (ready.length === 0) {
    console.log("Nothing to seed — all knockout matchups still TBD. Re-run after group stage ends.");
    return;
  }

  // Fetch existing knockout matches from DB to avoid duplicates
  const existing = await sbGet("matches?group_letter=not.like.%25_&select=group_letter,team_a,team_b");
  const existingSet = new Set(existing.map(m => `${m.group_letter}|${m.team_a}|${m.team_b}`));

  let inserted = 0, skipped = 0;
  for (const f of ready) {
    const stage = ROUND_TO_STAGE[f.league.round];
    const teamA = t(f.teams.home.name);
    const teamB = t(f.teams.away.name);
    const key = `${stage}|${teamA}|${teamB}`;

    if (existingSet.has(key)) {
      console.log(`  - [${stage}] ${teamA} vs ${teamB} — already exists, skipped`);
      skipped++;
      continue;
    }

    const row = {
      group_letter: stage,
      team_a: teamA,
      team_b: teamB,
      kickoff: f.fixture.date,
      venue: f.fixture.venue?.name || "",
      status: "scheduled"
    };

    try {
      await sbInsert(row);
      console.log(`  ✓ [${stage}] ${teamA} vs ${teamB} — ${f.fixture.date.slice(0, 10)}`);
      inserted++;
    } catch (e) {
      console.error(`  ✗ [${stage}] ${teamA} vs ${teamB} — ${e.message}`);
    }
  }

  console.log(`\nDone. Inserted ${inserted}, skipped ${skipped} (already existed).`);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
