// seed-fd-ids.js
// ─────────────────────────────────────────────────────────────────────
// One-time helper for the reliable-live-results-pipeline.
//
// Dumps the FULL football-data.org WC fixture list so each of our
// `matches` rows can be paired to its stable upstream `fd_match_id`.
// Pairing + apply is done deliberately, with a human eyeballing the
// kickoff/team correspondence, rather than trusting translated-name
// equality at poll time (which stranded Espanha vs Cabo Verde on
// 2026-06-15 — the API calls the team "Cape Verde Islands").
//
// USAGE (token is read from the local .env, same one test-api.js uses):
//   node seed-fd-ids.js
//
// Prints every WC fixture as:  fd_id | utcDate (UTC) | status | Home v Away
// sorted by kickoff. Paste the output back; the fd_match_id values are
// then written to matches.fd_match_id, matched on kickoff == utcDate.
//
// Re-run later (same way) once knockout rows are seeded into `matches`.
// ─────────────────────────────────────────────────────────────────────

require('dotenv').config();

const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN;

async function main() {
  if (!FOOTBALL_DATA_TOKEN) {
    console.error("Missing FOOTBALL_DATA_TOKEN (expected in .env).");
    process.exit(1);
  }

  const r = await fetch(
    "https://api.football-data.org/v4/competitions/WC/matches",
    { headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN } }
  );
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`football-data.org API ${r.status}: ${body}`);
  }
  const data = await r.json();
  const matches = data.matches || [];

  matches.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  console.log(`Total WC fixtures returned: ${matches.length}\n`);
  console.log("fd_id\tutcDate (UTC)\t\tstatus\t\tHome v Away");
  console.log("─".repeat(90));
  for (const m of matches) {
    const utc = m.utcDate.replace("T", " ").replace("Z", "");
    const status = (m.status || "").padEnd(10);
    console.log(`${m.id}\t${utc}\t${status}\t${m.homeTeam?.name} v ${m.awayTeam?.name}`);
  }
}

main().catch(e => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
