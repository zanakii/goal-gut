// Shared team name mapping: football-data.org English → Portuguese DB names.
// Used by fetch-results.js and seed-knockout.js. Multiple aliases per team
// are intentional — the upstream API has spelling variation across endpoints.
module.exports = {
  'Mexico': 'México',
  'South Korea': 'Coreia do Sul', 'Korea Republic': 'Coreia do Sul',
  'South Africa': 'África do Sul',
  'Czech Republic': 'Rep. Checa', 'Czechia': 'Rep. Checa',
  'Canada': 'Canadá', 'Switzerland': 'Suíça', 'Qatar': 'Qatar',
  'Bosnia And Herzegovina': 'Bósnia-Herzegovina', 'Bosnia Herzegovina': 'Bósnia-Herzegovina', 'Bosnia-Herzegovina': 'Bósnia-Herzegovina',
  'Brazil': 'Brasil', 'Morocco': 'Marrocos', 'Scotland': 'Escócia', 'Haiti': 'Haiti',
  'USA': 'EUA', 'United States': 'EUA', 'Australia': 'Austrália',
  'Paraguay': 'Paraguai',
  'Turkey': 'Turquia', 'Turkiye': 'Turquia', 'Türkiye': 'Turquia',
  'Germany': 'Alemanha', 'Ecuador': 'Equador',
  'Ivory Coast': 'Costa do Marfim', 'Cote D Ivoire': 'Costa do Marfim', "Côte d'Ivoire": 'Costa do Marfim',
  'Curacao': 'Curaçau', 'Curaçao': 'Curaçau',
  'Netherlands': 'Países Baixos', 'Japan': 'Japão', 'Tunisia': 'Tunísia',
  'Sweden': 'Suécia', 'Belgium': 'Bélgica',
  'Iran': 'Irão', 'IR Iran': 'Irão',
  'Egypt': 'Egito',
  'New Zealand': 'Nova Zelândia', 'Spain': 'Espanha', 'Uruguay': 'Uruguai',
  'Saudi Arabia': 'Arábia Saudita',
  // football-data.org returns "Cape Verde Islands"; keep the short form as an alias too.
  'Cape Verde': 'Cabo Verde', 'Cape Verde Islands': 'Cabo Verde',
  'France': 'França', 'Senegal': 'Senegal', 'Norway': 'Noruega', 'Iraq': 'Iraque',
  'Argentina': 'Argentina', 'Austria': 'Áustria', 'Algeria': 'Argélia', 'Jordan': 'Jordânia',
  'Portugal': 'Portugal', 'Colombia': 'Colômbia', 'Uzbekistan': 'Uzbequistão',
  'DR Congo': 'RD Congo', 'Congo DR': 'RD Congo',
  'England': 'Inglaterra', 'Croatia': 'Croácia', 'Panama': 'Panamá', 'Ghana': 'Gana',
};
