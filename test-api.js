require('dotenv').config();
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;

async function test() {
  const url = 'https://api.football-data.org/v4/competitions/WC/matches?dateFrom=2026-06-11&dateTo=2026-06-11';
  const res = await fetch(url, { headers: { 'X-Auth-Token': TOKEN } });

  console.log('Status:', res.status);
  console.log('Rate-limit remaining (this minute):', res.headers.get('x-requests-available-minute'));

  const data = await res.json();
  console.log('Matches count:', data.matches?.length ?? 0);

  if (data.matches?.length) {
    const first = data.matches[0];
    console.log('First match:', first.homeTeam.name, 'vs', first.awayTeam.name);
    console.log('Stage:', first.stage);
    console.log('Status:', first.status);
    console.log('UTC date:', first.utcDate);
  } else {
    console.log('Response:', JSON.stringify(data, null, 2).slice(0, 600));
  }
}

test();
