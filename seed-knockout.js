// seed-knockout.js
// ─────────────────────────────────────────────────────────────────────
// Run after each knockout round's brackets are confirmed by FIFA.
// Fetches knockout fixtures from football-data.org and seeds them
// into Supabase. The fetch-results.js workflow then auto-updates
// scores as each knockout match is played.
//
// Usage:
//   FOOTBALL_DATA_TOKEN=xxx SUPABASE_URL=https://... SUPABASE_KEY=xxx node seed-knockout.js
//
// Safe to re-run: skips matches that already exist (stage + team_a + team_b).
// ─────────────────────────────────────────────────────────────────────

const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const API_BASE = "https://api.football-data.org/v4";

// football-data.org stage → internal stage code (used as group_letter)
const STAGE_MAP = {
  "LAST_32":        "R32",
  "LAST_16":        "R16",
  "QUARTER_FINALS": "QF",
  "SEMI_FINALS":    "SF",
  "THIRD_PLACE":    "3P",
  "FINAL":          "FIN"
};

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
  if (!FOOTBALL_DATA_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing env vars: FOOTBALL_DATA_TOKEN, SUPABASE_URL, SUPABASE_KEY");
    process.exit(1);
  }

  console.log("Fetching all WC matches from football-data.org...");
  const r = await fetch(`${API_BASE}/competitions/WC/matches`, {
    headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN }
  });
  if (!r.ok) {
    console.error(`API ${r.status}: ${await r.text()}`);
    process.exit(1);
  }
  const data = await r.json();
  console.log(`Total matches returned: ${data.matches?.length ?? 0}`);

  const ko = (data.matches || [])
    .filter(m => STAGE_MAP[m.stage])
    .filter(m => m.homeTeam?.name && m.awayTeam?.name);

  console.log(`Knockout matches with confirmed teams: ${ko.length}\n`);

  if (ko.length === 0) {
    console.log("Nothing to seed — knockout matchups still TBD. Re-run after each round.");
    return;
  }

  const existing = await sbGet("matches?group_letter=in.(R32,R16,QF,SF,3P,F)&select=group_letter,team_a,team_b");
  const existingSet = new Set(existing.map(m => `${m.group_letter}|${m.team_a}|${m.team_b}`));

  let inserted = 0, skipped = 0;
  for (const m of ko) {
    const stage = STAGE_MAP[m.stage];
    const teamA = t(m.homeTeam.name);
    const teamB = t(m.awayTeam.name);
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
      kickoff: m.utcDate,
      fd_match_id: m.id,        // pair key for poll-results; without it KO scores never land
      venue: "",
      status: "scheduled"
    };

    try {
      await sbInsert(row);
      console.log(`  ✓ [${stage}] ${teamA} vs ${teamB} — ${m.utcDate.slice(0, 10)}`);
      inserted++;
    } catch (e) {
      console.error(`  ✗ [${stage}] ${teamA} vs ${teamB} — ${e.message}`);
    }
  }

  console.log(`\nDone. Inserted ${inserted}, skipped ${skipped} (already existed).`);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
