// Puebla la base de PRODUCCIÓN con: un torneo con zonas, 44 equipos
// (22 por zona) y 14 jugadores por equipo. NO genera fixture NI
// canchas/horarios: eso lo hace el admin desde el panel.
//
// ⚠️ Escribe en el sitio publicado. Requiere la ADMIN_PASSWORD real.
//
// Uso:
//   ADMIN_PASSWORD=xxxx node scripts/seed-prod.mjs [baseUrl]
//
// Variables de entorno (todas opcionales):
//   TOURNAMENT_NAME   nombre del torneo (default "Torneo 2026")
//   PLAYERS_PER_TEAM  jugadores por equipo, 0 = no cargar (default 14)
//
// Los nombres de los 44 equipos están acá abajo (los reales de producción);
// editá los arrays ZONA_A/ZONA_B si cambia el plantel de equipos.
const BASE = process.argv[2] ?? 'https://liga-amateur.pilin123.workers.dev';
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!PASSWORD) {
  console.error('Falta ADMIN_PASSWORD (es el secreto del sitio publicado).');
  console.error('Uso: ADMIN_PASSWORD=xxxx node scripts/seed-prod.mjs');
  process.exit(1);
}
const TOURNAMENT_NAME = process.env.TOURNAMENT_NAME ?? 'Torneo 2026';
const PLAYERS_PER_TEAM = Number(process.env.PLAYERS_PER_TEAM ?? 14);
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
if (login.status !== 302) throw new Error('login falló (¿contraseña?)');
console.log('✓ login');

// Id de equipo más alto ANTES de crear: los nuevos van a tener ids mayores,
// así los distinguimos de homónimos viejos si la base ya tenía equipos.
const before = await (await req('/admin/equipos')).text();
const maxIdBefore = Math.max(0, ...[...before.matchAll(/\/admin\/equipos\/(\d+)">Editar/g)].map((m) => Number(m[1])));

// ── 44 equipos: 22 por zona (nombres reales de producción) ──────────────────
const ZONA_A = [
  'Deportivo Almendro', 'Atlético Pampa', 'Club Riverito', 'Estrella del Sur',
  'Unión Ferroviaria', 'Sporting Pinar', 'Juventud Unida', 'Los Andes FC',
  'Boca del Puente', 'Racing de Viedma', 'Ferro Carril Sud', 'Central Córdoba Jr',
  'Talleres del Norte', 'Defensores del Sur', 'Huracán Pampero', 'Vélez del Litoral',
  'Estrella Roja FC', 'Banfield del Parque', 'Newbery Old Boys', 'Argentinos del Oeste',
  'Temperley Sudeste', 'Quilmes del Puerto',
];
const ZONA_B = [
  'Almagro Fútbol', 'Platense del Lago', 'Excursionistas FC', 'Gimnasia y Tiro',
  'River de la Orilla', 'San Martín del Norte', 'Colón del Riacho', 'Independiente Chaq.',
  'Lanús del Acuerdo', 'Boca del Puente Norte', 'Peñarol del Barrio', 'Nacional de Campo',
  'Liverpool del Oeste', 'Arsenal de Verano', 'Racing del Este', 'Sportivo Belgrano',
  'Unión de Reyes', 'Progreso Club', 'Comercio FC', 'Bancario Deportivo',
  'Policía Nacional FC', 'Correos United',
];

const ALL = [...ZONA_A, ...ZONA_B];
if (new Set(ALL.map((n) => n.toLowerCase())).size !== ALL.length) throw new Error('hay nombres repetidos');
if (ZONA_A.length !== 22 || ZONA_B.length !== 22) throw new Error('las zonas deben tener 22 cada una');

const created = [];
for (const name of ALL) {
  const short = name.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '').slice(0, 3).toUpperCase();
  const r = await req('/admin/equipos', {
    method: 'POST',
    body: form({ name, short_name: short, color: '#22c55e', active: 'on' }),
  });
  if (r.status !== 302) throw new Error(`equipo ${name}: ${r.status}`);
  created.push(name);
}
console.log(`✓ ${created.length} equipos creados`);

// ── resolver ids: solo filas con id > maxIdBefore (los recién creados) ──────
const html = await (await req('/admin/equipos')).text();
const idsByName = new Map();
for (const m of html.matchAll(/<strong>([^<]+)<\/strong>[\s\S]{0,300}?\/admin\/equipos\/(\d+)">Editar/g)) {
  const id = Number(m[2]);
  if (id > maxIdBefore) idsByName.set(m[1], id); // si hay homónimos, gana el último nuevo
}
const ourIds = ALL.map((n) => {
  const id = idsByName.get(n);
  if (!id) throw new Error(`no encontré el id de ${n}`);
  return id;
});
console.log('✓ ids resueltos');

// ── jugadores: 14 por equipo, nombres hispanos, camiseta 1..N ───────────────
const FIRST = ['Juan', 'Carlos', 'Diego', 'Matías', 'Leonardo', 'Nicolás', 'Federico', 'Gonzalo', 'Ezequiel', 'Iván', 'Bruno', 'Tomás', 'Facundo', 'Rodrigo', 'Sebastián', 'Emiliano', 'Agustín', 'Joaquín', 'Franco', 'Maximiliano', 'Lucas', 'Martín'];
const LAST = ['Gómez', 'Rodríguez', 'Fernández', 'López', 'Martínez', 'Pérez', 'Sánchez', 'Romero', 'Torres', 'Ramírez', 'Flores', 'Acosta', 'Benítez', 'Medina', 'Herrera', 'Aguirre', 'Molina', 'Ortiz', 'Silva', 'Castro', 'Ríos', 'Paredes'];
const POSITIONS = ['AR', 'DF', 'DF', 'DF', 'DF', 'MED', 'MED', 'MED', 'MED', 'DEL', 'DEL', 'DEL', 'MED', 'DF'];

let playerCount = 0;
if (PLAYERS_PER_TEAM > 0) {
  for (const [i, teamId] of ourIds.entries()) {
    for (let j = 0; j < PLAYERS_PER_TEAM; j++) {
      const name = `${FIRST[(i * 7 + j * 3) % FIRST.length]} ${LAST[(i * 11 + j * 5) % LAST.length]}`;
      const number = j === 0 ? 1 : j + 1;
      const r = await req('/admin/jugadores', {
        method: 'POST',
        body: form({ team_id: teamId, name, number, position: POSITIONS[j] ?? '' }),
      });
      if (r.status !== 302) throw new Error(`jugador de equipo ${teamId}: ${r.status}`);
      playerCount++;
    }
  }
  console.log(`✓ ${playerCount} jugadores cargados (${PLAYERS_PER_TEAM} por equipo)`);
} else {
  console.log('— jugadores omitidos (PLAYERS_PER_TEAM=0)');
}

// ── torneo con zonas 22/22, SIN canchas/horarios (los agrega el admin) ──────
const TOURNEY = {
  name: TOURNAMENT_NAME, season: '2026', format: 'zonas_playoffs', status: 'active',
  venues: '', kickoffs: '', start_date: '', round_gap: '7', play_weekday: '',
};
const t = await req('/admin/torneos', {
  method: 'POST',
  body: form({ ...TOURNEY, zones_enabled: 'on', zone_names: 'A\nB' }),
});
if (t.status !== 302) throw new Error('torneo: ' + t.status);

const anyFixture = await (await req('/admin/fixture')).text();
const tournamentId = /name="tournament_id" value="(\d+)"/.exec(anyFixture)?.[1];
if (!tournamentId) throw new Error('no encontré el id del torneo nuevo');

const body = new URLSearchParams({ ...TOURNEY, zones_enabled: 'on', zone_names: 'A\nB' });
ourIds.forEach((id, i) => body.set(`zone_of_${id}`, i < 22 ? '1' : '2'));
const upd = await req(`/admin/torneos/${tournamentId}`, { method: 'POST', body });
if (upd.status !== 302) throw new Error('zonas: ' + upd.status);
console.log(`✓ torneo "${TOURNAMENT_NAME}" creado con zonas 22/22 (sin fixture, sin canchas)`);
console.log(`\nTorneo id: ${tournamentId} — listo para canchas, horarios y fixture desde el panel.`);
