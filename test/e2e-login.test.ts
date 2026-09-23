// Test E2E de sesiones: corre contra un server real (wrangler dev) con D1
// local aislada, orquestado por scripts/test-e2e.mjs, que exporta
// ZONALIGA_E2E_BASE y ZONALIGA_E2E_PASS. Sin esas variables, el suite se
// omite (así `npm test` sigue funcionando sin server).
//
// Cubre el seam completo de sesiones por HTTP: guardia de /admin, login y
// logout admin con cookie, generación del código de delegado, login de
// delegado, carga de resultado y aprobación que publica en el sitio público.

import { beforeAll, describe, expect, it } from 'vitest';

const BASE = process.env.ZONALIGA_E2E_BASE ?? '';
const ADMIN_PASSWORD = process.env.ZONALIGA_E2E_PASS ?? '';
const has = Boolean(BASE && ADMIN_PASSWORD);

/** Cliente HTTP con sesiones: un solo factory para el rol admin y el de delegado. */
function client() {
  let cookie = '';
  return {
    get(path: string) {
      return fetch(`${BASE}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
    },
    async post(path: string, body: Record<string, string> = {}) {
      return fetch(`${BASE}${path}`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
        body: new URLSearchParams(body),
      });
    },
    async loginAdmin(password: string) {
      const res = await this.post('/admin/login', { password, next: '/admin' });
      cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
      return res;
    },
    async loginDelegate(codeValue: string) {
      const res = await this.post('/delegado/login', { code: codeValue, next: '/delegado' });
      cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
      return res;
    },
    async logoutAdmin() {
      const res = await this.get('/admin/logout');
      cookie = '';
      return res;
    },
  };
}

// Estado que arma el beforeAll (la D1 arranca vacía: todo se crea por HTTP).
let tournamentId = '';
let teamId = '';
let delegateCode = '';
let matchId = '';

beforeAll(async () => {
  if (!has) return;

  // Sonda: el server está arriba.
  expect((await fetch(`${BASE}/changelog`)).status).toBe(200);

  const admin = client();
  const login = await admin.loginAdmin(ADMIN_PASSWORD);
  expect(login.status).toBe(302);

  // Torneo activo, con canchas y horarios para el fixture.
  const t = await admin.post('/admin/torneos', {
    name: 'Copa E2E',
    season: '2026',
    format: 'round_robin',
    status: 'active',
    venues: 'Cancha Norte\nCancha Sur',
    kickoffs: '10:00, 12:00',
  });
  expect(t.status).toBe(302);

  // El fixture expone el tournament_id en su form de generación.
  const fixtureHtml = await (await admin.get('/admin/fixture')).text();
  tournamentId = /name="tournament_id" value="(\d+)"/.exec(fixtureHtml)?.[1] ?? '';
  expect(tournamentId, 'fixture debe exponer tournament_id').toBeTruthy();

  // Dos equipos activos.
  await admin.post('/admin/equipos', { name: 'Deportivo E2E', short_name: 'DEP', color: '#22c55e', active: 'on' });
  await admin.post('/admin/equipos', { name: 'Atlético E2E', short_name: 'ATE', color: '#0ea5e9', active: 'on' });
  const teamsHtml = await (await admin.get('/admin/equipos')).text();
  const ids = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!);
  expect(ids.length).toBeGreaterThanOrEqual(2);
  teamId = ids[0]!;

  // Fixture single round robin con 2 equipos = 1 partido.
  const gen = await admin.post('/admin/fixture/generar', { tournament_id: tournamentId, mode: 'single' });
  expect(gen.status).toBe(302);

  // Delegado habilitado + código (viene en el redirect del form de código).
  await admin.post(`/admin/equipos/${teamId}/delegado`, { delegate_name: 'Diego E2E', delegate_enabled: 'on' });
  const codeRes = await admin.post(`/admin/equipos/${teamId}/delegado/codigo`, {});
  const loc = codeRes.headers.get('location') ?? '';
  const msg = decodeURIComponent(/msg=([^&]+)/.exec(loc)?.[1] ?? '');
  delegateCode = /Código del delegado: ([A-Z0-9]{8})/.exec(msg)?.[1] ?? '';
  expect(delegateCode, 'el código debe venir en el redirect').toBeTruthy();
});

describe.skipIf(!has)('e2e: sesión admin', () => {
  it('guardia: sin cookie redirige a login con next', async () => {
    const res = await fetch(`${BASE}/admin`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/admin/login?next=%2Fadmin');
  });

  it('contraseña incorrecta: 401 y sin cookie de sesión', async () => {
    const res = await client().loginAdmin('no-es-la-clave');
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie') ?? '').not.toContain('zl_session=');
  });

  it('el fixture generado usa las canchas y horarios del torneo', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);
    const html = await (await admin.get('/admin/fechas')).text();
    expect(html).toContain('Cancha Norte');
    expect(html).toContain('10:00');
  });

  it('login correcto, dashboard y logout', async () => {
    const admin = client();
    const ok = await admin.loginAdmin(ADMIN_PASSWORD);
    expect(ok.status).toBe(302);
    expect(ok.headers.get('location')).toBe('/admin');

    const dash = await admin.get('/admin');
    expect(dash.status).toBe(200);
    expect(await dash.text()).toContain('Resumen');

    const out = await admin.logoutAdmin();
    expect(out.status).toBe(302);
    expect(out.headers.get('location')).toBe('/admin/login');

    const after = await admin.get('/admin');
    expect(after.status).toBe(302);
    expect(after.headers.get('location')).toContain('/admin/login');
  });
});

describe.skipIf(!has)('e2e: sesión delegado end-to-end', () => {
  it('guardia: sin cookie no hay home de delegado', async () => {
    const res = await fetch(`${BASE}/delegado`, { redirect: 'manual' });
    expect(res.status).toBe(302);
  });

  it('código inválido: 401', async () => {
    const res = await client().loginDelegate('ZZZZ9999');
    expect(res.status).toBe(401);
  });

  it('login con código, carga de resultado y aprobación del admin', async () => {
    // Home del delegado: solo los partidos de su equipo.
    const delegate = client();
    const login = await delegate.loginDelegate(delegateCode);
    expect(login.status).toBe(302);

    const home = await delegate.get('/delegado');
    expect(home.status).toBe(200);
    const homeHtml = await home.text();
    expect(homeHtml).toContain('Deportivo E2E');

    matchId = /href="\/delegado\/partido\/(\d+)">Cargar resultado/.exec(homeHtml)?.[1] ?? '';
    expect(matchId, 'el partido del fixture debe aparecer en su home').toBeTruthy();

    // Carga el resultado 3-1.
    const submit = await delegate.post(`/delegado/partido/${matchId}`, {
      status: 'played',
      home_goals: '3',
      away_goals: '1',
    });
    expect(submit.status).toBe(302);

    // Bandeja del admin: la entrega pendiente aparece con el equipo.
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);
    const trayHtml = await (await admin.get('/admin/entregas')).text();
    expect(trayHtml).toContain('Deportivo E2E');
    const subId = /\/admin\/entregas\/(\d+)\/aprobar/.exec(trayHtml)?.[1] ?? '';
    expect(subId).toBeTruthy();

    // Aprobación con resultado → publicado en el sitio público.
    const approve = await admin.post(`/admin/entregas/${subId}/aprobar`, { apply_score: 'on' });
    expect(approve.status).toBe(302);
    const publicHtml = await (await fetch(`${BASE}/`)).text();
    expect(publicHtml).toContain('3 - 1');
  });
});

describe.skipIf(!has)('e2e: ajustes manuales de puntos', () => {
  it('flujo completo: sin motivo rechaza, aplica penalización, publica el motivo y borra', async () => {
    const admin = client();
    const login = await admin.loginAdmin(ADMIN_PASSWORD);
    expect(login.status).toBe(302);

    // Sin motivo → redirect de error, nada creado.
    const noReason = await admin.post('/admin/ajustes', { team_id: teamId, delta: '-3', reason: '' });
    expect(noReason.status).toBe(302);
    expect(decodeURIComponent(noReason.headers.get('location') ?? '')).toContain('Documentá el motivo');

    // Penalización de -3 con motivo.
    const apply = await admin.post('/admin/ajustes', {
      team_id: teamId,
      delta: '-3',
      reason: 'Sanción del comité de disciplina',
    });
    expect(apply.status).toBe(302);

    // Aparece en el historial del panel.
    const panel = await (await admin.get('/admin/ajustes')).text();
    expect(panel).toContain('Sanción del comité de disciplina');

    // El sitio público documenta el motivo junto a la tabla.
    const standingsHtml = await (await fetch(`${BASE}/posiciones`)).text();
    expect(standingsHtml).toContain('Ajustes de puntos');
    expect(standingsHtml).toContain('Sanción del comité de disciplina');
    expect(standingsHtml).toContain('-3');

    // Borrar → el historial queda vacío y el aviso desaparece del sitio.
    const adjId = /\/admin\/ajustes\/(\d+)\/borrar/.exec(panel)?.[1] ?? '';
    expect(adjId, 'el historial debe exponer el botón de borrado').toBeTruthy();
    const del = await admin.post(`/admin/ajustes/${adjId}/borrar`, {});
    expect(del.status).toBe(302);
    const after = await (await admin.get('/admin/ajustes')).text();
    expect(after).not.toContain('Sanción del comité de disciplina');
    const publicAfter = await (await fetch(`${BASE}/posiciones`)).text();
    expect(publicAfter).not.toContain('Ajustes de puntos');
  });
});
