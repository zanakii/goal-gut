// seed-matches.js
// Run: node seed-matches.js
// Requires: npm install pg dotenv (already done)

require('dotenv').config();
const { Client } = require('pg');

const SUPABASE_URL = process.env.SUPABASE_CONNECTION_STRING;

// All 72 group stage matches — FIFA World Cup 2026
// Times in UTC (EDT - 4 hours for Eastern, BST - 1 hour for Portugal)
// Playoff winners confirmed: Bosnia-Herzegovina (Path A), Sweden (Path B),
// Türkiye (Path C), Czechia (Path D), DR Congo (FIFA PO 1), Iraq (FIFA PO 2)

const MATCHES = [
  // ─── GROUP A: Mexico, South Korea, South Africa, Czechia ─────────
  // MD1
  { group: 'A', teamA: 'México',         teamB: 'África do Sul',    date: '2026-06-11T19:00:00Z', venue: 'Estadio Azteca, Cidade do México' },
  { group: 'A', teamA: 'Coreia do Sul',   teamB: 'Rep. Checa',       date: '2026-06-12T01:00:00Z', venue: 'Estadio Akron, Guadalajara' },
  // MD2
  { group: 'A', teamA: 'Rep. Checa',      teamB: 'África do Sul',    date: '2026-06-18T16:00:00Z', venue: 'Mercedes-Benz Stadium, Atlanta' },
  { group: 'A', teamA: 'México',          teamB: 'Coreia do Sul',    date: '2026-06-19T01:00:00Z', venue: 'Estadio Akron, Guadalajara' },
  // MD3
  { group: 'A', teamA: 'Rep. Checa',      teamB: 'México',           date: '2026-06-25T01:00:00Z', venue: 'Estadio Azteca, Cidade do México' },
  { group: 'A', teamA: 'África do Sul',   teamB: 'Coreia do Sul',    date: '2026-06-25T01:00:00Z', venue: 'Estadio BBVA, Monterrey' },

  // ─── GROUP B: Canada, Switzerland, Qatar, Bosnia-Herzegovina ─────
  // MD1
  { group: 'B', teamA: 'Canadá',              teamB: 'Bósnia-Herzegovina', date: '2026-06-12T19:00:00Z', venue: 'BMO Field, Toronto' },
  { group: 'B', teamA: 'Qatar',               teamB: 'Suíça',              date: '2026-06-13T19:00:00Z', venue: "Levi's Stadium, São Francisco" },
  // MD2
  { group: 'B', teamA: 'Suíça',               teamB: 'Bósnia-Herzegovina', date: '2026-06-18T19:00:00Z', venue: 'SoFi Stadium, Los Angeles' },
  { group: 'B', teamA: 'Canadá',              teamB: 'Qatar',              date: '2026-06-19T01:00:00Z', venue: 'BC Place, Vancouver' },
  // MD3
  { group: 'B', teamA: 'Suíça',               teamB: 'Canadá',             date: '2026-06-25T01:00:00Z', venue: 'BC Place, Vancouver' },
  { group: 'B', teamA: 'Bósnia-Herzegovina',  teamB: 'Qatar',              date: '2026-06-24T19:00:00Z', venue: 'Lumen Field, Seattle' },

  // ─── GROUP C: Brazil, Morocco, Scotland, Haiti ───────────────────
  // MD1
  { group: 'C', teamA: 'Brasil',        teamB: 'Marrocos',    date: '2026-06-13T22:00:00Z', venue: 'MetLife Stadium, Nova Iorque' },
  { group: 'C', teamA: 'Haiti',         teamB: 'Escócia',     date: '2026-06-14T01:00:00Z', venue: 'Gillette Stadium, Boston' },
  // MD2
  { group: 'C', teamA: 'Escócia',       teamB: 'Marrocos',    date: '2026-06-19T22:00:00Z', venue: 'Gillette Stadium, Boston' },
  { group: 'C', teamA: 'Brasil',        teamB: 'Haiti',        date: '2026-06-20T01:00:00Z', venue: 'Lincoln Financial Field, Filadélfia' },
  // MD3
  { group: 'C', teamA: 'Escócia',       teamB: 'Brasil',       date: '2026-06-24T22:00:00Z', venue: 'Hard Rock Stadium, Miami' },
  { group: 'C', teamA: 'Marrocos',      teamB: 'Haiti',        date: '2026-06-24T22:00:00Z', venue: 'Mercedes-Benz Stadium, Atlanta' },

  // ─── GROUP D: USA, Australia, Paraguay, Türkiye ──────────────────
  // MD1
  { group: 'D', teamA: 'EUA',          teamB: 'Paraguai',     date: '2026-06-13T01:00:00Z', venue: 'SoFi Stadium, Los Angeles' },
  { group: 'D', teamA: 'Austrália',    teamB: 'Turquia',      date: '2026-06-13T04:00:00Z', venue: 'BC Place, Vancouver' },
  // MD2
  { group: 'D', teamA: 'EUA',          teamB: 'Austrália',    date: '2026-06-19T19:00:00Z', venue: 'Lumen Field, Seattle' },
  { group: 'D', teamA: 'Turquia',      teamB: 'Paraguai',     date: '2026-06-20T01:00:00Z', venue: "Levi's Stadium, São Francisco" },
  // MD3
  { group: 'D', teamA: 'Turquia',      teamB: 'EUA',          date: '2026-06-26T02:00:00Z', venue: 'SoFi Stadium, Los Angeles' },
  { group: 'D', teamA: 'Paraguai',     teamB: 'Austrália',    date: '2026-06-26T02:00:00Z', venue: "Levi's Stadium, São Francisco" },

  // ─── GROUP E: Germany, Ecuador, Côte d'Ivoire, Curaçao ──────────
  // MD1
  { group: 'E', teamA: 'Alemanha',         teamB: 'Curaçau',           date: '2026-06-14T17:00:00Z', venue: 'NRG Stadium, Houston' },
  { group: 'E', teamA: 'Costa do Marfim',  teamB: 'Equador',           date: '2026-06-14T23:00:00Z', venue: 'Lincoln Financial Field, Filadélfia' },
  // MD2
  { group: 'E', teamA: 'Alemanha',         teamB: 'Costa do Marfim',   date: '2026-06-20T20:00:00Z', venue: 'BMO Field, Toronto' },
  { group: 'E', teamA: 'Equador',          teamB: 'Curaçau',           date: '2026-06-21T00:00:00Z', venue: 'Arrowhead Stadium, Kansas City' },
  // MD3
  { group: 'E', teamA: 'Equador',          teamB: 'Alemanha',          date: '2026-06-25T20:00:00Z', venue: 'MetLife Stadium, Nova Iorque' },
  { group: 'E', teamA: 'Curaçau',          teamB: 'Costa do Marfim',   date: '2026-06-25T20:00:00Z', venue: 'Lincoln Financial Field, Filadélfia' },

  // ─── GROUP F: Netherlands, Japan, Tunisia, Sweden ────────────────
  // MD1
  { group: 'F', teamA: 'Países Baixos',  teamB: 'Japão',      date: '2026-06-14T20:00:00Z', venue: 'AT&T Stadium, Dallas' },
  { group: 'F', teamA: 'Suécia',         teamB: 'Tunísia',    date: '2026-06-15T01:00:00Z', venue: 'Estadio BBVA, Monterrey' },
  // MD2
  { group: 'F', teamA: 'Países Baixos',  teamB: 'Suécia',     date: '2026-06-20T17:00:00Z', venue: 'NRG Stadium, Houston' },
  { group: 'F', teamA: 'Tunísia',        teamB: 'Japão',      date: '2026-06-21T04:00:00Z', venue: 'Estadio BBVA, Monterrey' },
  // MD3
  { group: 'F', teamA: 'Japão',          teamB: 'Suécia',     date: '2026-06-25T23:00:00Z', venue: 'AT&T Stadium, Dallas' },
  { group: 'F', teamA: 'Tunísia',        teamB: 'Países Baixos', date: '2026-06-25T23:00:00Z', venue: 'Arrowhead Stadium, Kansas City' },

  // ─── GROUP G: Belgium, Iran, Egypt, New Zealand ──────────────────
  // Note: Iran have withdrawn; FIFA decision on replacement TBD
  // Keeping Iran as placeholder — update when FIFA confirms
  { group: 'G', teamA: 'Bélgica',        teamB: 'Egito',         date: '2026-06-15T19:00:00Z', venue: 'Lumen Field, Seattle' },
  { group: 'G', teamA: 'Irão',           teamB: 'Nova Zelândia', date: '2026-06-16T01:00:00Z', venue: 'SoFi Stadium, Los Angeles' },
  // MD2
  { group: 'G', teamA: 'Bélgica',        teamB: 'Irão',          date: '2026-06-21T19:00:00Z', venue: 'SoFi Stadium, Los Angeles' },
  { group: 'G', teamA: 'Nova Zelândia',  teamB: 'Egito',         date: '2026-06-22T01:00:00Z', venue: 'BC Place, Vancouver' },
  // MD3
  { group: 'G', teamA: 'Egito',          teamB: 'Irão',          date: '2026-06-27T03:00:00Z', venue: 'Lumen Field, Seattle' },
  { group: 'G', teamA: 'Nova Zelândia',  teamB: 'Bélgica',       date: '2026-06-27T03:00:00Z', venue: 'BC Place, Vancouver' },

  // ─── GROUP H: Spain, Uruguay, Saudi Arabia, Cape Verde ───────────
  // MD1
  { group: 'H', teamA: 'Espanha',          teamB: 'Cabo Verde',      date: '2026-06-15T16:00:00Z', venue: 'Mercedes-Benz Stadium, Atlanta' },
  { group: 'H', teamA: 'Arábia Saudita',   teamB: 'Uruguai',         date: '2026-06-15T22:00:00Z', venue: 'Hard Rock Stadium, Miami' },
  // MD2
  { group: 'H', teamA: 'Espanha',          teamB: 'Arábia Saudita',  date: '2026-06-21T16:00:00Z', venue: 'Mercedes-Benz Stadium, Atlanta' },
  { group: 'H', teamA: 'Uruguai',          teamB: 'Cabo Verde',      date: '2026-06-21T22:00:00Z', venue: 'Hard Rock Stadium, Miami' },
  // MD3
  { group: 'H', teamA: 'Cabo Verde',       teamB: 'Arábia Saudita',  date: '2026-06-27T00:00:00Z', venue: 'NRG Stadium, Houston' },
  { group: 'H', teamA: 'Uruguai',          teamB: 'Espanha',         date: '2026-06-27T00:00:00Z', venue: 'Estadio Akron, Guadalajara' },

  // ─── GROUP I: France, Senegal, Norway, Iraq ──────────────────────
  // MD1
  { group: 'I', teamA: 'França',     teamB: 'Senegal',   date: '2026-06-16T19:00:00Z', venue: 'MetLife Stadium, Nova Iorque' },
  { group: 'I', teamA: 'Iraque',     teamB: 'Noruega',   date: '2026-06-16T22:00:00Z', venue: 'Gillette Stadium, Boston' },
  // MD2
  { group: 'I', teamA: 'França',     teamB: 'Iraque',    date: '2026-06-22T21:00:00Z', venue: 'Lincoln Financial Field, Filadélfia' },
  { group: 'I', teamA: 'Noruega',    teamB: 'Senegal',   date: '2026-06-23T00:00:00Z', venue: 'MetLife Stadium, Nova Iorque' },
  // MD3
  { group: 'I', teamA: 'Noruega',    teamB: 'França',     date: '2026-06-26T19:00:00Z', venue: 'Gillette Stadium, Boston' },
  { group: 'I', teamA: 'Senegal',    teamB: 'Iraque',     date: '2026-06-26T19:00:00Z', venue: 'BMO Field, Toronto' },

  // ─── GROUP J: Argentina, Austria, Algeria, Jordan ────────────────
  // MD1
  { group: 'J', teamA: 'Argentina',  teamB: 'Argélia',   date: '2026-06-17T01:00:00Z', venue: 'Arrowhead Stadium, Kansas City' },
  { group: 'J', teamA: 'Áustria',    teamB: 'Jordânia',  date: '2026-06-17T04:00:00Z', venue: "Levi's Stadium, São Francisco" },
  // MD2
  { group: 'J', teamA: 'Argentina',  teamB: 'Áustria',   date: '2026-06-22T17:00:00Z', venue: 'AT&T Stadium, Dallas' },
  { group: 'J', teamA: 'Jordânia',   teamB: 'Argélia',   date: '2026-06-23T03:00:00Z', venue: "Levi's Stadium, São Francisco" },
  // MD3
  { group: 'J', teamA: 'Argélia',    teamB: 'Áustria',   date: '2026-06-28T02:00:00Z', venue: 'Arrowhead Stadium, Kansas City' },
  { group: 'J', teamA: 'Jordânia',   teamB: 'Argentina', date: '2026-06-28T02:00:00Z', venue: 'AT&T Stadium, Dallas' },

  // ─── GROUP K: Portugal, Colombia, Uzbekistan, DR Congo ───────────
  // MD1
  { group: 'K', teamA: 'Portugal',       teamB: 'RD Congo',      date: '2026-06-17T17:00:00Z', venue: 'NRG Stadium, Houston' },
  { group: 'K', teamA: 'Uzbequistão',    teamB: 'Colômbia',      date: '2026-06-18T02:00:00Z', venue: 'Estadio Azteca, Cidade do México' },
  // MD2
  { group: 'K', teamA: 'Portugal',       teamB: 'Uzbequistão',   date: '2026-06-23T17:00:00Z', venue: 'NRG Stadium, Houston' },
  { group: 'K', teamA: 'Colômbia',       teamB: 'RD Congo',      date: '2026-06-24T02:00:00Z', venue: 'Estadio Akron, Guadalajara' },
  // MD3
  { group: 'K', teamA: 'Colômbia',       teamB: 'Portugal',      date: '2026-06-27T23:00:00Z', venue: 'Hard Rock Stadium, Miami' },
  { group: 'K', teamA: 'RD Congo',       teamB: 'Uzbequistão',  date: '2026-06-27T23:00:00Z', venue: 'Mercedes-Benz Stadium, Atlanta' },

  // ─── GROUP L: England, Croatia, Panama, Ghana ────────────────────
  // MD1
  { group: 'L', teamA: 'Inglaterra',  teamB: 'Croácia',   date: '2026-06-17T20:00:00Z', venue: 'AT&T Stadium, Dallas' },
  { group: 'L', teamA: 'Gana',        teamB: 'Panamá',    date: '2026-06-17T23:00:00Z', venue: 'BMO Field, Toronto' },
  // MD2
  { group: 'L', teamA: 'Inglaterra',  teamB: 'Gana',      date: '2026-06-23T20:00:00Z', venue: 'Gillette Stadium, Boston' },
  { group: 'L', teamA: 'Panamá',      teamB: 'Croácia',   date: '2026-06-23T23:00:00Z', venue: 'BMO Field, Toronto' },
  // MD3
  { group: 'L', teamA: 'Panamá',      teamB: 'Inglaterra', date: '2026-06-27T21:00:00Z', venue: 'MetLife Stadium, Nova Iorque' },
  { group: 'L', teamA: 'Croácia',     teamB: 'Gana',       date: '2026-06-27T21:00:00Z', venue: 'Lincoln Financial Field, Filadélfia' },
];

async function seed() {
  console.log(`Seeding ${MATCHES.length} group stage matches...\n`);

  const db = new Client({ connectionString: SUPABASE_URL });
  await db.connect();
  console.log('Connected to Supabase.\n');

  let inserted = 0;
  for (const m of MATCHES) {
    try {
      const result = await db.query(
        `INSERT INTO matches (group_letter, team_a, team_b, kickoff, venue, status)
         VALUES ($1, $2, $3, $4, $5, 'scheduled')
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [m.group, m.teamA, m.teamB, m.date, m.venue]
      );
      if (result.rowCount > 0) {
        inserted++;
        console.log(`  ✓ [${m.group}] ${m.teamA} vs ${m.teamB} — ${m.date.slice(0, 10)}`);
      } else {
        console.log(`  - [${m.group}] ${m.teamA} vs ${m.teamB} — already exists, skipped`);
      }
    } catch (err) {
      console.error(`  ✗ [${m.group}] ${m.teamA} vs ${m.teamB} — ERROR: ${err.message}`);
    }
  }

  await db.end();
  console.log(`\nDone! Inserted ${inserted} new matches (${MATCHES.length - inserted} already existed).`);
}

seed().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
