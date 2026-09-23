// Genera seed.sql usando el MISMO generador de fixture de la app,
// así los datos de ejemplo siempre son un round-robin válido.
//
//   node --experimental-strip-types scripts/gen-seed.ts
//
import { writeFileSync } from 'node:fs';
import { generateRoundRobin } from '../src/lib/fixture.ts';

/* ---------- PRNG determinista ---------- */
let state = 20260923;
function rnd(): number {
  state = (state * 1664525 + 1013904223) % 4294967296;
  return state / 4294967296;
}
function pick<T>(list: T[]): T {
  return list[Math.floor(rnd() * list.length)]!;
}
function goals(): number {
  const r = rnd();
  if (r < 0.22) return 0;
  if (r < 0.55) return 1;
  if (r < 0.8) return 2;
  if (r < 0.93) return 3;
  return 4;
}
const sql = (s: string) => `'${s.replace(/'/g, "''")}'`;

/* ---------- Equipos y plantillas (4 jugadores cada uno) ---------- */
interface Tm {
  name: string;
  short: string;
  color: string;
  squad: Array<[string, number, string]>;
}

const teams: Tm[] = [
  { name: 'Deportivo Almendro', short: 'ALM', color: '#e11d48', squad: [['Mariano Ledesma', 10, 'MED'], ['Iván Sosa', 9, 'DEL'], ['Facundo Ríos', 4, 'DF'], ['Tomás Aguirre', 1, 'AR']] },
  { name: 'Atlético Pampa', short: 'PAM', color: '#2563eb', squad: [['Diego Bustos', 7, 'DEL'], ['Santiago Paz', 5, 'MED'], ['Emiliano Cruz', 2, 'DF'], ['Joaquín Vera', 1, 'AR']] },
  { name: 'Club Riverito', short: 'RIV', color: '#dc2626', squad: [['Nicolás Ferreyra', 11, 'DEL'], ['Ramiro Ojeda', 8, 'MED'], ['Lautaro Giménez', 3, 'DF'], ['Bruno Salas', 1, 'AR']] },
  { name: 'Estrella del Sur', short: 'EDS', color: '#7c3aed', squad: [['Matías Quintero', 9, 'DEL'], ['Franco Duarte', 6, 'MED'], ['Agustín Ibarra', 2, 'DF'], ['Ezequiel Ruiz', 1, 'AR']] },
  { name: 'Unión Ferroviaria', short: 'UFR', color: '#ea580c', squad: [['Leandro Molina', 10, 'DEL'], ['Cristian Vera', 8, 'MED'], ['Iván Peralta', 4, 'DF'], ['Marcos Ledesma', 1, 'AR']] },
  { name: 'Sporting Pinar', short: 'SPI', color: '#059669', squad: [['Julián Cardozo', 9, 'DEL'], ['Gonzalo Miranda', 5, 'MED'], ['Kevin Arce', 3, 'DF'], ['Alan Benítez', 1, 'AR']] },
  { name: 'Juventud Unida', short: 'JUV', color: '#0891b2', squad: [['Rodrigo Salazar', 7, 'DEL'], ['Nahuel Ortega', 6, 'MED'], ['Damián Escobar', 2, 'DF'], ['Lucas Maldonado', 1, 'AR']] },
  { name: 'Los Andes FC', short: 'AND', color: '#4f46e5', squad: [['Fernando Núñez', 10, 'DEL'], ['Emiliano Godoy', 8, 'MED'], ['Axel Ferreyra', 3, 'DF'], ['Sergio Báez', 1, 'AR']] },
  { name: 'Boca del Puente', short: 'BDP', color: '#0d9488', squad: [['Gastón Villalba', 9, 'DEL'], ['Emanuel Roldán', 7, 'MED'], ['Cristian Ocampo', 4, 'DF'], ['Iker Domínguez', 1, 'AR']] },
  { name: 'Racing de Viedma', short: 'RDV', color: '#65a30d', squad: [['Thiago Ávalos', 8, 'DEL'], ['Óscar Carrizo', 5, 'MED'], ['Maximiliano Luna', 2, 'DF'], ['Ian Juárez', 1, 'AR']] },
];

const teamIds = teams.map((_, i) => i + 1);
// id de jugador: (equipo-1)*4 + (1..4)
const playerId = (teamId: number, idx: number) => (teamId - 1) * 4 + idx;

/* ---------- Fixture real (algoritmo del círculo) ---------- */
const fixture = generateRoundRobin(teamIds);

// Autochequeo: cada equipo juega una vez por fecha y no hay cruces repetidos.
const seen = new Set<string>();
for (const round of fixture.rounds) {
  const playing = new Set<number>();
  for (const p of round) {
    const key = [p.home, p.away].sort((a, b) => a - b).join('-');
    if (seen.has(key)) throw new Error(`Cruce repetido: ${key}`);
    seen.add(key);
    if (playing.has(p.home) || playing.has(p.away)) throw new Error('Equipo dos veces en la misma fecha');
    playing.add(p.home);
    playing.add(p.away);
  }
}
console.log(`Fixture OK: ${fixture.rounds.length} fechas, ${seen.size} cruces únicos`);

/* ---------- Fechas del calendario (domingos) ---------- */
const START = new Date(Date.UTC(2026, 7, 16)); // dom 16 ago 2026
function dateOf(roundIdx: number): string {
  const d = new Date(START.getTime() + roundIdx * 7 * 86400000);
  return d.toISOString().slice(0, 10);
}
const PLAYED_ROUNDS = 6; // fechas 1..6 jugadas, 7..9 programadas

/* ---------- Generación de partidos y eventos ---------- */
interface MatchRow {
  id: number;
  round: number;
  home: number;
  away: number;
  status: string;
  hg: number;
  ag: number;
}
const matches: MatchRow[] = [];
const events: Array<[number, number, number, string, number | null]> = []; // match, team, player, type, minute
const yellowCount = new Map<number, number>();

let mid = 1;
const TIMES = ['10:00', '10:00', '12:00', '12:00', '16:00'];

fixture.rounds.forEach((round, r) => {
  const roundNo = r + 1;
  round.forEach((pair, i) => {
    const id = mid++;
    const isPlayed = roundNo <= PLAYED_ROUNDS;
    const isPostponed = roundNo === 6 && i === 2; // una postergada de ejemplo
    const isWalkover = roundNo === 5 && i === 4; // un walkover de ejemplo

    if (isPostponed) {
      matches.push({ id, round: roundNo, home: pair.home, away: pair.away, status: 'postponed', hg: 0, ag: 0 });
      return;
    }
    if (!isPlayed) {
      matches.push({ id, round: roundNo, home: pair.home, away: pair.away, status: 'scheduled', hg: 0, ag: 0 });
      return;
    }

    if (isWalkover) {
      matches.push({ id, round: roundNo, home: pair.home, away: pair.away, status: 'walkover', hg: 1, ag: 0 });
      return;
    }

    const hg = goals();
    const ag = goals();
    matches.push({ id, round: roundNo, home: pair.home, away: pair.away, status: 'played', hg, ag });

    // Goles: se generan exactamente los goles del marcador, repartidos con peso por posición.
    const scorerFor = (teamId: number): number => {
      const r2 = rnd();
      const idx = r2 < 0.55 ? 2 : r2 < 0.85 ? 1 : r2 < 0.97 ? 3 : 4; // DEL, MED, DF, AR (1-based)
      return playerId(teamId, idx);
    };
    const rows: Array<[number, number, number, string, number]> = [];
    for (let g = 0; g < hg; g++) rows.push([id, pair.home, scorerFor(pair.home), 'goal', 1 + Math.floor(rnd() * 90)]);
    for (let g = 0; g < ag; g++) rows.push([id, pair.away, scorerFor(pair.away), 'goal', 1 + Math.floor(rnd() * 90)]);

    // Tarjetas: 1-3 amarillas por partido; una roja en una fecha puntual.
    const yellows = 1 + Math.floor(rnd() * 3);
    for (let y = 0; y < yellows; y++) {
      const teamId = rnd() < 0.5 ? pair.home : pair.away;
      const p = playerId(teamId, pick([1, 2, 3, 4]));
      rows.push([id, teamId, p, 'yellow', 1 + Math.floor(rnd() * 90)]);
      yellowCount.set(p, (yellowCount.get(p) ?? 0) + 1);
    }
    if (roundNo === 3 && i === 0) rows.push([id, pair.away, playerId(pair.away, 3), 'red', 62]);
    if (roundNo === 4 && i === 1) rows.push([id, pair.home, playerId(pair.home, 2), 'own_goal', 77]);

    rows.sort((a, b) => a[4] - b[4]);
    for (const row of rows) events.push(row);
  });
});

// Un jugador clave acumula 4 amarillas => queda suspendido (regla del torneo: acumulación 4).
const acumula = [10, 11, 12, 13]; // Mariano Ledesma (equipo 1, MED) en fechas 1-4
for (let i = 0; i < acumula.length; i++) {
  const match = matches.find((m) => m.round === i + 1 && (m.home === 1 || m.away === 1) && m.status === 'played');
  if (match) events.push([match.id, 1, acumula[i] === 10 ? playerId(1, 1) : playerId(1, 1), 'yellow', 30 + i]);
}

/* ---------- SQL ---------- */
const out: string[] = [];
out.push('-- Datos de ejemplo: "Copa Barrial 2026" (ficticio, generado automáticamente).');
out.push('-- Regenerar con: node --experimental-strip-types scripts/gen-seed.ts');
out.push('-- Cargar con:    npm run db:seed:local   (o db:seed:remote)');
out.push('-- Borrar con:    npm run db:unseed:local');
out.push('');
out.push(`INSERT INTO tournaments (name, slug, season, format, config, status) VALUES
('Copa Barrial 2026', 'copa-barrial-2026', '2026', 'round_robin',
 '{"win":3,"draw":1,"loss":0,"walkoverGoals":3,"yellowAccumulation":4,"yellowAccumWindow":0,"redSuspensionMatches":1,"bonusRules":[]}',
 'active');`);
out.push('');

out.push('INSERT INTO teams (name, slug, short_name, color) VALUES');
out.push(
  teams
    .map((t, i) => `(${sql(t.name)}, ${sql(slug(t.name, i + 1))}, ${sql(t.short)}, ${sql(t.color)})`)
    .join(',\n') + ';'
);
out.push('');

out.push('INSERT INTO players (team_id, name, number, position) VALUES');
const playerRows: string[] = [];
teams.forEach((t, i) => {
  for (const [name, number, position] of t.squad) {
    playerRows.push(`(${i + 1}, ${sql(name)}, ${number}, ${sql(position)})`);
  }
});
out.push(playerRows.join(',\n') + ';');
out.push('');

const venue = (i: number) => (i % 2 === 0 ? 'Cancha 1' : 'Cancha 2');
out.push(
  'INSERT INTO matches (tournament_id, round, home_team_id, away_team_id, played_on, kickoff_time, venue, status, home_goals, away_goals) VALUES'
);
const matchRows: string[] = [];
fixture.rounds.forEach((round, r) => {
  round.forEach((pair, i) => {
    const m = matches.find((x) => x.round === r + 1 && x.home === pair.home && x.away === pair.away)!;
    matchRows.push(
      `(1, ${r + 1}, ${pair.home}, ${pair.away}, ${sql(dateOf(r))}, ${sql(TIMES[i]!)}, ${sql(venue(i))}, ${sql(m.status)}, ${m.hg}, ${m.ag})`
    );
  });
});
out.push(matchRows.join(',\n') + ';');
out.push('');

if (events.length > 0) {
  out.push('INSERT INTO events (match_id, team_id, player_id, type, minute) VALUES');
  out.push(
    events
      .map(([matchId, teamId, pId, type, minute]) => `(${matchId}, ${teamId}, ${pId}, ${sql(type)}, ${minute ?? 'NULL'})`)
      .join(',\n') + ';'
  );
  out.push('');
}

writeFileSync('seed.sql', out.join('\n'), { encoding: 'utf8' });
console.log(`seed.sql generado: ${teams.length} equipos, ${playerRows.length} jugadores, ${matches.length} partidos, ${events.length} eventos`);
console.log(`Fechas 1-${PLAYED_ROUNDS} jugadas · ${fixture.rounds.length - PLAYED_ROUNDS} programadas`);

function slug(name: string, id: number): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `equipo-${id}`;
}
