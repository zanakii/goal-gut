require('dotenv').config();
const API_KEY = process.env.API_FOOTBALL_KEY;

async function findLeague() {
  const res = await fetch(
    'https://v3.football.api-sports.io/leagues?search=world cup',
    { headers: { 'x-apisports-key': API_KEY } }
  );
  const data = await res.json();

  console.log('Remaining API requests today:',
    res.headers.get('x-ratelimit-requests-remaining'));

  for (const league of data.response) {
    console.log(`ID: ${league.league.id} | ${league.league.name} | Type: ${league.league.type}`);
  }
}

findLeague();