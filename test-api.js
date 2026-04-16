require('dotenv').config();
const API_KEY = process.env.API_FOOTBALL_KEY;

async function test() {
  const res = await fetch(
    'https://v3.football.api-sports.io/fixtures?league=1&season=2026',
    { headers: { 'x-apisports-key': API_KEY } }
  );

  console.log('Status:', res.status);
  console.log('Remaining requests:', res.headers.get('x-ratelimit-requests-remaining'));

  const data = await res.json();
  console.log('Results count:', data.results);

  if (data.response && data.response.length > 0) {
    const first = data.response[0];
    console.log('First match:', first.teams.home.name, 'vs', first.teams.away.name);
    console.log('Round:', first.league.round);
    console.log('Date:', first.fixture.date);
  } else {
    console.log('Errors:', JSON.stringify(data.errors));
  }
}

test();