// db-snapshot.js
// Print a compact snapshot of every public table — row counts, max id,
// newest created_at, and unique/PK constraints — so you can diff before
// and after a mutating operation. Usage:
//
//   node db-snapshot.js                  # print to stdout
//   node db-snapshot.js > before.txt     # capture pre-state
//   node db-snapshot.js > after.txt
//   diff before.txt after.txt            # see exactly what moved
//
// Read-only. Never writes. Connects via SUPABASE_CONNECTION_STRING.

require('dotenv').config();
const { Client } = require('pg');

const TABLES = [
  'players',
  'matches',
  'predictions',
  'podium_predictions',
  'bracket_predictions',
  'tournament_config',
  'app_events',
];

async function snapshot() {
  const db = new Client({ connectionString: process.env.SUPABASE_CONNECTION_STRING });
  await db.connect();

  console.log(`=== DB snapshot @ ${new Date().toISOString()} ===\n`);

  // Pull constraints once so we can render them per-table.
  const constraints = await db.query(`
    SELECT cls.relname AS table_name,
           con.contype AS type,
           pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class cls       ON cls.oid = con.conrelid
    JOIN pg_namespace nsp   ON nsp.oid = cls.relnamespace
    WHERE nsp.nspname = 'public'
      AND con.contype IN ('p', 'u')
    ORDER BY cls.relname, con.contype, con.conname;
  `);
  const byTable = {};
  for (const r of constraints.rows) {
    (byTable[r.table_name] ??= []).push({ type: r.type, def: r.def });
  }

  for (const t of TABLES) {
    // Detect optional columns so the query stays generic across schemas.
    // Only call max() on numeric id columns — UUIDs don't have an ordering.
    const cols = await db.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
    `, [t]);
    const colType = (c) => cols.rows.find(r => r.column_name === c)?.data_type;
    const numericId = ['integer', 'bigint', 'smallint'].includes(colType('id'));

    const selects = ['count(*) AS rows'];
    if (numericId)             selects.push('max(id) AS max_id');
    if (colType('created_at')) selects.push('max(created_at) AS newest');

    const { rows: [stats] } = await db.query(`SELECT ${selects.join(', ')} FROM public.${t}`);

    const parts = [`${stats.rows.padStart(5)} rows`];
    if (stats.max_id !== undefined) parts.push(`max_id=${stats.max_id}`);
    if (stats.newest !== undefined && stats.newest !== null) {
      parts.push(`newest=${new Date(stats.newest).toISOString()}`);
    }

    console.log(`${t.padEnd(22)} ${parts.join('  ')}`);
    for (const c of byTable[t] || []) {
      const label = c.type === 'p' ? 'PK  ' : 'UNIQ';
      console.log(`  ${label}  ${c.def}`);
    }
    console.log('');
  }

  await db.end();
}

snapshot().catch(err => {
  console.error('Snapshot failed:', err.message);
  process.exit(1);
});
