// Puebla la base LOCAL (wrangler dev) con equipos, jugadores y un torneo con
// 2 zonas y fixture ya generado. NO toca producción: para eso está seed-prod.
//
// No borra nada: si ya corrió una vez, crea duplicados (los nombres repetidos
// ganan un sufijo en el slug). Para arrancar de cero: npm run db:unseed:local
// && npm run db:migrate:local.
//
// Uso:
//   node scripts/seed-dev.mjs [baseUrl]
//   TEAMS_PER_ZONE=8 PLAYERS_PER_TEAM=10 node scripts/seed-dev.mjs
//
// Variables de entorno (todas opcionales):
//   TEAMS_PER_ZONE     equipos por zona (default 15 → 30 en total)
//   PLAYERS_PER_TEAM   jugadores por equipo (default 14)
//   TOURNAMENT_NAME    nombre del torneo (default "Liga de Prueba 2026")
//   SHUFFLE_TEAMS      1 = mezcla los equipos entre zonas al azar (default 0)
//   ADMIN_PASSWORD     clave del panel (default: la clave de dev de auth.ts)
const BASE = process.argv[2] ?? 'http://127.0.0.1:8790';
// Clave de desarrollo del panel local (DEV_SECRET_FALLBACK de src/lib/auth.ts;
// solo aplica cuando no hay ADMIN_PASSWORD configurado).
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'zonaliga-dev-secret-change-me';

const TEAMS_PER_ZONE = Number(process.env.TEAMS_PER_ZONE ?? 15);
const PLAYERS_PER_TEAM = Number(process.env.PLAYERS_PER_TEAM ?? 14);
const TOURNAMENT_NAME = process.env.TOURNAMENT_NAME ?? 'Liga de Prueba 2026';
const SHUFFLE_TEAMS = process.env.SHUFFLE_TEAMS === '1';

if (!Number.isInteger(TEAMS_PER_ZONE) || TEAMS_PER_ZONE < 2 || TEAMS_PER_ZONE > 32) {
  throw new Error('TEAMS_PER_ZONE debe ser un entero entre 2 y 32');
}
if (!Number.isInteger(PLAYERS_PER_TEAM) || PLAYERS_PER_TEAM < 0 || PLAYERS_PER_TEAM > 30) {
  throw new Error('PLAYERS_PER_TEAM debe ser un entero entre 0 y 30');
}

let cookie = '';
async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    redirect: 'manual',
    ...opts,
    headers: { ...(opts.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) },
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return res;
}
const form = (obj) => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) body.set(k, String(v));
  return body;
};

const login = await req('/admin/login', { method: 'POST', body: form({ password: PASSWORD, next: '/admin' }) });
if (login.status !== 302) throw new Error(`login falló (status ${login.status}); ¿ADMIN_PASSWORD correcta?`);
console.log('✓ login');

// Id de equipo más alto ANTES de crear: los nuevos van a tener ids mayores,
// así los distinguimos de homónimos viejos si la base ya tenía equipos.
const before = await (await req('/admin/equipos')).text();
const maxIdBefore = Math.max(0, ...[...before.matchAll(/\/admin\/equipos\/(\d+)">Editar/g)].map((m) => Number(m[1])));
if (maxIdBefore > 0) {
  console.log(`⚠️  la base ya tiene equipos (id máx ${maxIdBefore}). Si el fixture falla con "Sin zona",`);
  console.log('   limpiá la base y volvé a correr: npm run db:unseed:local && npm run db:migrate:local');
}

// ── equipos: nombres realistas, generados (no repetibles entre corridas) ────
const CITY = ['Almendro', 'Pampa', 'Riverito', 'Estrella', 'Ferro', 'Pinar', 'Delta', 'Barracas', 'Litoral', 'Pampero', 'Puerto', 'Norte', 'Sud', 'Centro', 'Costa', 'Sierra', 'Lago', 'Riacho', 'Alto', 'Bajo'];
const CLUB = ['Deportivo', 'Atlético', 'Club', 'Sporting', 'Unión', 'Juventud', 'Defensores', 'Huracán', 'Talleres', 'Estrella'];
const MISC = ['FC', 'Old Boys', 'Jr.', 'del Sur', 'del Norte', 'del Oeste'];

const TEAM_NAMES = Array.from({ length: TEAMS_PER_ZONE * 2 }, (_, i) => {
  const club = CLUB[i % CLUB.length];
  const city = CITY[(i * 7 + 3) % CITY.length];
  const extra = i >= CLUB.length ? ` ${MISC[i % MISC.length]}` : '';
  return `${club} ${city}${extra}`;
});

for (const name of TEAM_NAMES) {
  const short = name.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '').slice(0, 3).toUpperCase();
  const r = await req('/admin/equipos', {
    method: 'POST',
    body: form({ name, short_name: short, color: '#22c55e', active: 'on' }),
  });
  if (r.status !== 302) throw new Error(`equipo ${name}: ${r.status}`);
}
console.log(`✓ ${TEAM_NAMES.length} equipos creados`);

// ── resolver ids: solo filas con id > maxIdBefore (los recién creados) ──────
const html = await (await req('/admin/equipos')).text();
const ourTeams = [];
for (const name of TEAM_NAMES) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rowRe = new RegExp(`<strong>${escaped}</strong>[\\s\\S]{0,300}?/admin/equipos/(\\d+)">Editar`, 'g');
  let last = null;
  for (const m of html.matchAll(rowRe)) {
    if (Number(m[1]) > maxIdBefore) last = m;
  }
  if (!last) throw new Error(`no encontré el id de ${name}`);
  ourTeams.push(Number(last[1]));
}

// ── jugadores: nombres hispanos, camiseta 1..N, posiciones realistas ────────
const FIRST = ['Juan', 'Carlos', 'Diego', 'Matías', 'Leonardo', 'Nicolás', 'Federico', 'Gonzalo', 'Ezequiel', 'Iván', 'Bruno', 'Tomás', 'Facundo', 'Rodrigo', 'Sebastián', 'Emiliano', 'Agustín', 'Joaquín', 'Franco', 'Maximiliano'];
const LAST = ['Gómez', 'Rodríguez', 'Fernández', 'López', 'Martínez', 'Pérez', 'Sánchez', 'Romero', 'Torres', 'Ramírez', 'Flores', 'Acosta', 'Benítez', 'Medina', 'Herrera', 'Aguirre', 'Molina', 'Ortiz', 'Silva', 'Castro'];
const POSITIONS = ['AR', 'DF', 'DF', 'DF', 'DF', 'MED', 'MED', 'MED', 'MED', 'DEL', 'DEL', 'DEL', 'MED', 'DF'];

let playerCount = 0;
for (const [ti, teamId] of ourTeams.entries()) {
  for (let j = 0; j < PLAYERS_PER_TEAM; j++) {
    const name = `${FIRST[(ti * 7 + j * 3) % FIRST.length]} ${LAST[(ti * 11 + j * 5) % LAST.length]}`;
    const number = j === 0 ? 1 : j + 1;
    const r = await req('/admin/jugadores', {
      method: 'POST',
      body: form({ team_id: teamId, name, number, position: POSITIONS[j] ?? '' }),
    });
    if (r.status !== 302) throw new Error(`jugador de ${teamId}: ${r.status}`);
    playerCount++;
  }
}
console.log(`✓ ${playerCount} jugadores cargados (${PLAYERS_PER_TEAM} por equipo)`);

// ── torneo con 2 zonas, canchas de ejemplo y fixture generado ───────────────
const TOURNEY = {
  name: TOURNAMENT_NAME, season: '2026', format: 'zonas_playoffs', status: 'active',
  venues: 'Cancha 1\nCancha 2\nCancha 3', kickoffs: '10:00, 11:00, 12:00, 13:00',
  start_date: '2026-10-03', round_gap: '7', play_weekday: '6', // sábados
};
const t = await req('/admin/torneos', {
  method: 'POST',
  body: form({ ...TOURNEY, zones_enabled: 'on', zone_names: 'A\nB' }),
});
if (t.status !== 302) throw new Error('torneo: ' + t.status);

const fixtureHtml = await (await req('/admin/fixture')).text();
const tournamentId = /name="tournament_id" value="(\d+)"/.exec(fixtureHtml)?.[1];
if (!tournamentId) throw new Error('no encontré el id del torneo nuevo');

// Asignación de zonas: por orden (mitad A, mitad B) o mezclada al azar.
const zoneOrder = ourTeams.map((id, i) => i < TEAMS_PER_ZONE ? 1 : 2);
if (SHUFFLE_TEAMS) {
  for (let i = zoneOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [zoneOrder[i], zoneOrder[j]] = [zoneOrder[j], zoneOrder[i]];
  }
}
const body = new URLSearchParams({ ...TOURNEY, zones_enabled: 'on', zone_names: 'A\nB' });
ourTeams.forEach((id, i) => body.set(`zone_of_${id}`, String(zoneOrder[i])));
const upd = await req(`/admin/torneos/${tournamentId}`, { method: 'POST', body });
if (upd.status !== 302) throw new Error('zonas: ' + upd.status);

const gen = await req('/admin/fixture/generar', {
  method: 'POST',
  body: form({ tournament_id: tournamentId, mode: 'single' }),
});
const genLoc = decodeURIComponent(gen.headers.get('location') ?? '');
console.log('✓ fixture:', genLoc.split('msg=')[1] ?? genLoc);

console.log('\n── RESUMEN ──');
console.log(`Torneo: ${TOURNAMENT_NAME} (id ${tournamentId})`);
console.log(`Equipos: ${TEAM_NAMES.length} (${TEAMS_PER_ZONE} por zona) · Jugadores: ${playerCount}`);
console.log(`Ver en: ${BASE}/fixture`);
