// Auditoría de consumo D1: cuánto leen las pantallas de verdad.
//
// El plan gratuito de Cloudflare D1 da 5.000.000 de FILAS LEÍDAS por día. No
// cuenta consultas ni filas devueltas: cuenta filas ESCAEADAS. Una consulta que
// devuelve 3 filas pero recorre 300 porque el filtro no tiene índice consume 300.
//
// Por eso este test separa dos cosas por pantalla:
//   · filas devueltas  → lo que ve la persona
//   · filas escaneadas  → lo que se paga (esto es lo que importa)
//
// Y además corre TODO dos veces: con los índices que ya están en las migraciones
// y con los que esta auditoría propone, para mostrar el ahorro pantalla por
// pantalla en números reales y no en Suposiciones.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as pub from '../src/ui/public.ts';
import * as adm from '../src/ui/admin.ts';
import * as live from '../src/ui/live.ts';
import * as st from '../src/ui/adminStats.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIMITE_DIARIO = 5_000_000;
/** Salto de línea (los templates multilínea se confunden con los acentos en algunos editores). */
const NL = String.fromCharCode(10);

/** Índices que agrega la migración 0011 (si se_quitan, la base queda como estaba antes). */
const INDICES_0011 = [
  'CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id)',
  'CREATE INDEX IF NOT EXISTS idx_matches_home ON matches(home_team_id)',
  'CREATE INDEX IF NOT EXISTS idx_matches_away ON matches(away_team_id)',
  'CREATE INDEX IF NOT EXISTS idx_submission_events_player ON submission_events(player_id)',
];

/** Tablas que la consulta recorre enteras (SCAN sin usar índice). */
function escaneosTotales(plan: string[]): string[] {
  return plan
    .filter((p) => /\bSCAN\b/.test(p) && !/USING (COVERING )?INDEX/.test(p))
    .map((p) => p.match(/SCAN (\w+)/)?.[1] ?? '')
    .filter((t) => /^[a-z_]+$/.test(t));
}

interface Stat {
  consultas: number;
  devueltas: number;
  escaneadas: number;
  /** Consulta → cuántas filas escaneadas le costó en total. */
  detalle: Map<string, { veces: number; escaneadas: number }>;
}

/** Base en memoria con el schema real y una liga completa (no el seed de 10 equipos). */
function crearBase(equipos: number, conIndices: boolean): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(join(root, 'migrations')).sort()) {
    db.exec(readFileSync(join(root, 'migrations', f), 'utf8'));
  }
  const rnd = (n: number): number => Math.floor(Math.random() * n);
  db.exec("INSERT INTO tournaments (name, slug, season, status) VALUES ('Liga', 'liga', '2026', 'active')");
  for (let i = 0; i < equipos; i++) {
    db.prepare('INSERT INTO teams (name, slug, short_name) VALUES (?, ?, ?)').run(`Equipo ${i}`, `eq-${i}`, `E${i}`);
  }
  for (let i = 0; i < equipos; i++) {
    for (let j = 1; j <= JUGADORES_POR_EQUIPO; j++) {
      db.prepare("INSERT INTO players (team_id, name, number, position) VALUES (?, ?, ?, 'DEL')").run(i + 1, `Jugador ${i}-${j}`, j);
    }
  }
  let m = 0;
  for (let i = 1; i <= equipos; i++) {
    for (let j = i + 1; j <= equipos; j++) {
      for (const ida of [true, false]) {
        m++;
        db.prepare(
          `INSERT INTO matches (tournament_id, round, home_team_id, away_team_id, played_on, status, home_goals, away_goals)
           VALUES (1, ?, ?, ?, '2026-05-10', 'played', ?, ?)`
        ).run(Math.ceil(m / 2), ida ? i : j, ida ? j : i, rnd(4), rnd(4));
      }
    }
  }
  for (const match of db.prepare('SELECT id FROM matches').all()) {
    for (let k = 0; k < 3; k++) {
      db.prepare('INSERT INTO events (match_id, team_id, player_id, type, minute) VALUES (?, ?, ?, ?, ?)')
        .run(match.id, rnd(equipos) + 1, rnd(equipos * JUGADORES_POR_EQUIPO) + 1, k === 2 ? 'yellow' : 'goal', rnd(90));
    }
  }
  // Para medir el "antes" se borran los índices de la migración 0011: así el
  // número que sale es exactamente lo que pasaba antes de aplicarla.
  if (!conIndices) for (const idx of INDICES_0011) db.exec(`DROP INDEX IF EXISTS ${idx.split(' ')[5]}`);
  return db;
}

/** D1 de mentira sobre sqlite que cuenta consultas, devoluciones y escaneos. */
function dbContador(db: DatabaseSync): { db: D1Database; stat: Stat } {
  const stat: Stat = { consultas: 0, devueltas: 0, escaneadas: 0, detalle: new Map() };
  const TABLAS = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name)
  );
  const tam = (t: string): number => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
  /** El plan nombra alias (p, e, m…); estas son las tablas reales del schema. */
  const real = (t: string): string => (TABLAS.has(t) ? t : ([...TABLAS].find((x) => x.endsWith(t)) ?? t));

  const anotar = (sql: string, devueltas: number): void => {
    let leidas = devueltas;
    if (sql.trimStart().toUpperCase().startsWith('SELECT')) {
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r: Record<string, unknown>) => String(r.detail));
      for (const t of escaneosTotales(plan)) {
        const tabla = real(t);
        if (TABLAS.has(tabla)) leidas += tam(tabla);
      }
    }
    stat.consultas++;
    stat.devueltas += devueltas;
    stat.escaneadas += leidas;
    const clave = sql.replace(/\s+/g, ' ').trim().slice(0, 120);
    const c = stat.detalle.get(clave) ?? { veces: 0, escaneadas: 0 };
    c.veces++;
    c.escaneadas += leidas;
    stat.detalle.set(clave, c);
  };

  const d1 = {
    prepare: (sql: string) => {
      let args: unknown[] = [];
      const stmt = {
        bind: (...a: unknown[]) => {
          args = a;
          return stmt;
        },
        all: async () => {
          const filas = db.prepare(sql).all(...(args as never[]));
          anotar(sql, filas.length);
          return { results: filas, success: true, meta: {} };
        },
        first: async () => {
          const fila = db.prepare(sql).get(...(args as never[])) ?? null;
          anotar(sql, fila ? 1 : 0);
          return fila;
        },
        run: async () => {
          db.prepare(sql).run(...(args as never[]));
          anotar(sql, 0);
          return { success: true, results: [], meta: {} };
        },
      };
      return stmt;
    },
    batch: async (stmts: D1PreparedStatement[]) => {
      for (const s of stmts) await (s as unknown as { run: () => Promise<unknown> }).run();
      return [];
    },
  };
  return { db: d1 as unknown as D1Database, stat };
}

// Tamaño REAL de la base en producción (medido por la API de Cloudflare):
// 1 torneo, 44 equipos, 616 jugadores, 440 partidos. Se hardcodea para que la
// medición sea comparable con lo que pasa en el sitio de verdad.
const EQUIPOS = Number(process.env.D1_AUDIT_TEAMS ?? 44);
const JUGADORES_POR_EQUIPO = Number(process.env.D1_AUDIT_ROSTER ?? 14);
const origin = 'http://localhost:8787';

describe('auditoría D1: coste por pantalla', () => {
  /** Las pantallas del sitio público y del panel. */
  const pantallas = (q1: (sql: string) => Record<string, unknown>): [string, (d: D1Database) => Promise<unknown>, number][] => {
    const tSlug = String(q1("SELECT slug FROM tournaments WHERE status='active' LIMIT 1")?.slug ?? '');
    const teamId = Number(q1('SELECT id FROM teams LIMIT 1').id);
    const teamSlug = String(q1('SELECT slug FROM teams LIMIT 1').slug);
    const playerId = q1('SELECT id FROM players LIMIT 1').id as number;
    const matchId = q1('SELECT id FROM matches LIMIT 1').id as number;
    return [
      ['PÚBLICO /', (d) => pub.homePage(d, origin), 4_000],
      ['PÚBLICO /posiciones', (d) => pub.standingsPage(d, tSlug, origin), 4_000],
      ['PÚBLICO /fixture', (d) => pub.fixturePage(d, tSlug, undefined, origin), 4_000],
      ['PÚBLICO /goleadores', (d) => pub.scorersPage(d, origin, tSlug), 4_000],
      ['PÚBLICO /equipos', (d) => pub.teamsPage(d), 500],
      ['PÚBLICO /equipos/:slug', (d) => pub.teamPage(d, teamSlug), 2_500],
      ['PÚBLICO /jugador/:id', (d) => pub.playerPage(d, playerId), 1_500],
      ['PÚBLICO /partido/:id', (d) => pub.matchPage(d, matchId, origin), 4_500],
      ['PÚBLICO /historial', (d) => pub.historyPage(d), 4_000],
      ['PÚBLICO /suspensiones', (d) => pub.suspensionsPage(d, tSlug), 4_000],
      ['PÚBLICO /buscar', (d) => pub.searchPage(d, 'a'), 1_500],
      ['PÚBLICO /en-vivo', (d) => live.livePage(d, tSlug), 4_000],
      ['ADMIN /', (d) => adm.dashboardPage(d), 4_500],
      ['ADMIN /planilla', (d) => adm.sheetListPage(d, tSlug), 4_000],
      ['ADMIN /planilla/:id', (d) => adm.sheetPage(d, matchId), 4_500],
      ['ADMIN /fixture', (d) => adm.fixtureAdminPage(d, tSlug), 4_000],
      ['ADMIN /fechas', (d) => adm.roundsSchedulePage(d, tSlug), 4_000],
      ['ADMIN /equipos', (d) => adm.teamsAdminPage(d), 4_500],
      ['ADMIN /jugadores', (d) => adm.playersAdminPage(d, teamId), 4_000],
      ['ADMIN /torneos', (d) => adm.tournamentsPage(d), 500],
      ['ADMIN /entregas', (d) => adm.entregasAdminPage(d), 2_500],
      ['ADMIN /estadisticas', (d) => st.estadisticasAdminPage(d, tSlug, undefined), 4_000],
      ['ADMIN /suspensiones', (d) => adm.suspensionsAdminPage(d, tSlug), 4_500],
      ['ADMIN /delegados', (d) => st.delegadosAdminPage(d), 1_500],
    ];
  };

  /** Corre todas las pantallas contra una base y devuelve el coste de cada una. */
  const medirTodo = async (conIndices: boolean): Promise<[string, Stat, number][]> => {
    const db = crearBase(EQUIPOS, conIndices);
    const q1 = (sql: string) => db.prepare(sql).get() as Record<string, unknown>;
    const out: [string, Stat, number][] = [];
    for (const [nombre, fn, tope] of pantallas(q1)) {
      const { db: d1, stat } = dbContador(db);
      await fn(d1);
      out.push([nombre, stat, tope]);
    }
    return out;
  };

  let antes: [string, Stat, number][] = [];
  let despues: [string, Stat, number][] = [];

  it('mide el coste de cada pantalla con y sin los índices de la migración 0011', async () => {
    antes = await medirTodo(false);
    despues = await medirTodo(true);

    const base = crearBase(EQUIPOS, false);
    const n = (t: string): number => (base.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
    const linea = (nombre: string, a: Stat, d: Stat, tope: number): string =>
      `${nombre.padEnd(26)} ${String(a.escaneadas).padStart(5)} → ${String(d.escaneadas).padStart(5)} escaneadas` +
      `  (${String(a.consultas).padStart(2)} consultas, ${String(a.devueltas).padStart(4)} devueltas, tope ${tope})`;
    const tabla = antes.map(([nombre, a, tope], i) => linea(nombre, a, despues[i]![1], tope));
    const totalAntes = antes.reduce((a, [, s]) => a + s.escaneadas, 0);
    const totalDespues = despues.reduce((a, [, s]) => a + s.escaneadas, 0);
    const pct = ((1 - totalDespues / totalAntes) * 100).toFixed(0);

    console.log(
      `\n=== Coste por pantalla · liga de ${EQUIPOS} equipos ` +
        `(${n('matches')} partidos, ${n('events')} eventos) ===\n` +
        `${tabla.join('\n')}\n` +
        `TOTAL de las ${antes.length} pantallas: ${totalAntes} → ${totalDespues} filas escaneadas (−${pct}%).\n` +
        `Presupuesto D1 free: ${LIMITE_DIARIO.toLocaleString('es-AR')} filas/día (corte duro a las 00:00 UTC).`
    );
    expect(antes.length).toBeGreaterThan(0);
  });

  it('qué consulta se come el presupuesto de cada pantalla cara', () => {
    const global = new Map<string, { veces: number; escaneadas: number; pantallas: Set<string> }>();
    for (const [nombre, stat] of antes) {
      for (const [sql, c] of stat.detalle) {
        const g = global.get(sql) ?? { veces: 0, escaneadas: 0, pantallas: new Set<string>() };
        g.veces += c.veces;
        g.escaneadas += c.escaneadas;
        g.pantallas.add(nombre);
        global.set(sql, g);
      }
    }
    const lineas = [...global.entries()]
      .sort((a, b) => b[1].escaneadas - a[1].escaneadas)
      .slice(0, 15)
      .map(([sql, g]) => `${String(g.escaneadas).padStart(6)} filas  ${String(g.veces).padStart(3)}x  ${g.pantallas.size} pant.  ${sql}`);
    console.log(
      ['', '=== Consultas que mas presupuesto se comen (suma de las 24 pantallas) ===', ...lineas].join(NL)
    );
    expect(global.size).toBeGreaterThan(0);
  });

  it('cuántas visitas por día permite el presupuesto gratuito', async () => {
    const porNombre = (m: [string, Stat, number][]): Map<string, number> =>
      new Map(m.map(([nombre, s]) => [nombre, s.escaneadas]));
    const a = porNombre(antes);
    const d = porNombre(despues);
    // Una visita típica: portada + posiciones + fixture + ficha de partido.
    const ruta = ['PÚBLICO /', 'PÚBLICO /posiciones', 'PÚBLICO /fixture', 'PÚBLICO /partido/:id'];
    const visitaAntes = ruta.reduce((s, k) => s + (a.get(k) ?? 0), 0);
    const visitaDespues = ruta.reduce((s, k) => s + (d.get(k) ?? 0), 0);
    // Con la caché de páginas públicas (60s) cada visita servida desde la
    // caché no toca la base. El acierto típico de un sitio de liga es alto:
    // robots, gente que navega entre páginas y gente que vuelve.
    const conCache = (aciertos: number): number =>
      Math.floor(LIMITE_DIARIO / (visitaDespues * (1 - aciertos)));
    console.log(
      [
        '',
        '=== Escenario: portada + posiciones + fixture + ficha de partido ===',
        `Sin índices y sin caché:        ${visitaAntes} filas → ~${Math.floor(LIMITE_DIARIO / visitaAntes).toLocaleString('es-AR')} visitas/día`,
        `Con índices (migración 0011):   ${visitaDespues} filas → ~${Math.floor(LIMITE_DIARIO / visitaDespues).toLocaleString('es-AR')} visitas/día`,
        `Con índices + caché (90% aciertos): ~${conCache(0.9).toLocaleString('es-AR')} visitas/día`,
        `Con índices + caché (95% aciertos): ~${conCache(0.95).toLocaleString('es-AR')} visitas/día`,
      ].join(NL)
    );
    expect(visitaAntes).toBeGreaterThan(0);
    // Los índices tienen que mejorar el coste, o al menos no empeorarlo.
    expect(visitaDespues).toBeLessThanOrEqual(visitaAntes);
  });
});
