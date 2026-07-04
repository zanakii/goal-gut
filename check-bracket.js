// check-bracket.js
// Bracket-integrity check for the knockout stage. Once a stage is fully decided,
// every team it produces (winners → next round; SF losers → 3rd-place match) must
// appear in exactly one slot of the round it feeds. A null slot here is the
// Brasil-v-Noruega bug: a pairing that never got written. This catches it and,
// when only one slot is open, names the team that belongs there.
//
// Run it when advancing a round — e.g. the moment R16 finishes, before trusting
// the QF cards. Read-only, never writes. Connects via SUPABASE_CONNECTION_STRING.
//
//   node check-bracket.js        # prints a per-transition report
//   exit 0 = clean, exit 1 = at least one gap found
//
// The poller (supabase/functions/poll-results) runs the same invariant every
// minute and logs a ⚠ bracket gap warning; this script is the on-demand version.

require('dotenv').config();
const { Client } = require('pg');

// [feeder stage, stage it feeds, what the feeder contributes]. The winner chain
// plus SF→3P (the two beaten semi-finalists). 3P/FIN are both fed by SF.
const FEEDS = [
  ['R32', 'R16', 'winner'],
  ['R16', 'QF', 'winner'],
  ['QF', 'SF', 'winner'],
  ['SF', 'FIN', 'winner'],
  ['SF', '3P', 'loser'],
];
const TERMINAL = new Set(['finished', 'pen-home', 'pen-away']);

function winnerOf(m) {
  if (m.score_a == null) return null;
  if (m.score_a > m.score_b) return m.team_a;
  if (m.score_b > m.score_a) return m.team_b;
  if (m.status === 'pen-home') return m.team_a;
  if (m.status === 'pen-away') return m.team_b;
  return null;
}
function loserOf(m) {
  const w = winnerOf(m);
  if (!w) return null;
  return w === m.team_a ? m.team_b : m.team_a;
}

async function main() {
  const db = new Client({ connectionString: process.env.SUPABASE_CONNECTION_STRING });
  await db.connect();
  const { rows } = await db.query(
    `select group_letter, team_a, team_b, score_a, score_b, status
       from matches
      where group_letter in ('R32','R16','QF','SF','3P','FIN')`
  );
  await db.end();

  const byStage = g => rows.filter(m => m.group_letter === g);
  const teamsIn = g => new Set(byStage(g).flatMap(m => [m.team_a, m.team_b]).filter(Boolean));
  const allTerminal = g => { const r = byStage(g); return r.length > 0 && r.every(m => TERMINAL.has(m.status)); };
  const nullSlots = g => byStage(g).reduce((n, m) => n + (m.team_a == null ? 1 : 0) + (m.team_b == null ? 1 : 0), 0);

  console.log(`=== Bracket integrity @ ${new Date().toISOString()} ===\n`);
  let gaps = 0;
  for (const [stage, next, kind] of FEEDS) {
    if (byStage(stage).length === 0) continue;
    if (!allTerminal(stage)) {
      console.log(`  · ${stage}→${next}: ${stage} not finished yet — nothing to verify`);
      continue;
    }
    const produce = kind === 'winner' ? winnerOf : loserOf;
    const present = teamsIn(next);
    const missing = byStage(stage).map(produce).filter(t => t && !present.has(t));
    const holes = nullSlots(next);
    if (missing.length || holes) {
      gaps++;
      const named = missing.length ? missing.join(', ') : 'unknown';
      console.log(`  ⚠ ${stage}→${next}: ${stage} complete but ${next} has ${holes} unfilled slot(s). Missing ${kind}(s): ${named}`);
    } else {
      console.log(`  ✓ ${stage}→${next}: all ${present.size} ${kind}s placed`);
    }
  }
  console.log(gaps === 0 ? '\nClean — no bracket gaps.' : `\n${gaps} gap(s) found — back-fill the slot(s) above.`);
  process.exit(gaps === 0 ? 0 : 1);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(2); });
