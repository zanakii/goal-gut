// export-archive.js
// Dump the finished tournament to a single JSON file — the durable off-Supabase
// copy of the pool, and the replay dataset the EURO fork's Step 0 needs
// (see porting/EURO-fork-runbook.md). Usage:
//
//   node export-archive.js                    # → backups/goalgut-<edition>-<date>.json
//   node export-archive.js path/to/out.json   # explicit destination
//
// Read-only. Never writes to the DB. Connects via SUPABASE_CONNECTION_STRING.
//
// ⚠ COLUMNS ARE WHITELISTED, NEVER `SELECT *`. `players.code` IS THE PIN, in
// plaintext — it is excluded here and must stay excluded. A column-level GRANT
// keeps it away from the anon key; this script connects with full credentials,
// so the whitelist is the only thing standing between a PIN and a file. If you
// add a table below, list its columns explicitly and check them by hand first.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// table → { cols, order }. Ordered deterministically so two dumps of unchanged
// data diff cleanly.
const TABLES = {
  players:             { cols: ['id', 'name', 'short_name', 'is_observer', 'created_at'], order: 'name' },
  matches:             { cols: ['id', 'external_id', 'fd_match_id', 'group_letter', 'team_a', 'team_b', 'kickoff', 'venue', 'score_a', 'score_b', 'status'], order: 'kickoff, id' },
  predictions:         { cols: ['id', 'player_id', 'match_id', 'score_a', 'score_b', 'created_at'], order: 'player_id, match_id' },
  podium_predictions:  { cols: ['id', 'player_id', 'first_place', 'second_place', 'third_place', 'created_at'], order: 'player_id' },
  bracket_predictions: { cols: ['id', 'player_id', 'round', 'slot', 'picked_team', 'created_at', 'updated_at'], order: 'player_id, round, slot' },
  tournament_config:   { cols: ['key', 'value'], order: 'key' },
  app_events:          { cols: ['id', 'player_id', 'event', 'metadata', 'created_at'], order: 'id' },
};

async function main() {
  const db = new Client({ connectionString: process.env.SUPABASE_CONNECTION_STRING });
  await db.connect();

  const data = {};
  for (const [table, { cols, order }] of Object.entries(TABLES)) {
    // Fail loudly if the schema drifted — a silently-missing column would mean a
    // silently-incomplete archive, which is the one failure mode that matters here.
    const present = (await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`, [table]
    )).rows.map(r => r.column_name);
    const missing = cols.filter(c => !present.includes(c));
    if (missing.length) throw new Error(`${table}: whitelisted column(s) no longer exist: ${missing.join(', ')}`);

    const { rows } = await db.query(`SELECT ${cols.join(', ')} FROM ${table} ORDER BY ${order}`);
    data[table] = rows;
    console.log(`  ${table.padEnd(20)} ${String(rows.length).padStart(5)} rows`);
  }
  await db.end();

  // A couple of derived headline facts, so a human opening this file in 2028 can
  // tell what it is without running anything.
  const final = data.matches.find(m => m.group_letter === 'FIN');
  const champion = final && final.score_a !== null
    ? (final.score_a > final.score_b ? final.team_a
      : final.score_b > final.score_a ? final.team_b
      : final.status === 'pen-home' ? final.team_a : final.team_b)
    : null;

  const out = {
    _meta: {
      exported_at: new Date().toISOString(),
      source: 'supabase thjvoocszfzqkyatkevv (World Cup 2026)',
      champion,
      matches_played: data.matches.filter(m => m.score_a !== null).length,
      note: 'PINs (players.code) deliberately excluded. See export-archive.js header.',
    },
    ...data,
  };

  const dest = process.argv[2] || path.join('backups', `goalgut-wc2026-${new Date().toISOString().slice(0, 10)}.json`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(`\n✓ ${dest}  (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)  champion: ${champion}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
