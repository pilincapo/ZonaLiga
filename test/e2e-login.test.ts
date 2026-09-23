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

  // Torneo activo, con canchas, horarios y fecha de inicio para el calendario.
  const t = await admin.post('/admin/torneos', {
    name: 'Copa E2E',
    season: '2026',
    format: 'round_robin',
    status: 'active',
    venues: 'Cancha Norte\nCancha Sur',
    kickoffs: '10:00, 12:00',
    start_date: '2026-10-05',
    round_gap: '7',
    play_weekday: '6', // liga de sábados
  });
  expect(t.status).toBe(302);

  // El fixture expone el tournament_id en su form de generación.
  const fixtureHtml = await (await admin.get('/admin/fixture')).text();
  tournamentId = /name="tournament_id" value="(\d+)"/.exec(fixtureHtml)?.[1] ?? '';
  expect(tournamentId, 'fixture debe exponer tournament_id').toBeTruthy();

  // Cuatro equipos activos: cada fecha del fixture doble tiene 2 partidos.
  await admin.post('/admin/equipos', { name: 'Deportivo E2E', short_name: 'DEP', color: '#22c55e', active: 'on' });
  await admin.post('/admin/equipos', { name: 'Atlético E2E', short_name: 'ATE', color: '#0ea5e9', active: 'on' });
  await admin.post('/admin/equipos', { name: 'Villa E2E', short_name: 'VIL', color: '#f59e0b', active: 'on' });
  await admin.post('/admin/equipos', { name: 'Norte E2E', short_name: 'NOR', color: '#ef4444', active: 'on' });
  const teamsHtml = await (await admin.get('/admin/equipos')).text();
  const ids = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!);
  expect(ids.length).toBeGreaterThanOrEqual(2);
  // El id del delegado se busca por nombre: la página ordena alfabéticamente
  // y el orden de creación no es confiable.
  teamId = /Deportivo E2E[\s\S]*?\/admin\/equipos\/(\d+)">Editar/.exec(teamsHtml)?.[1] ?? '';
  expect(teamId, 'el id de Deportivo E2E debe estar en la página').toBeTruthy();

  // Fixture doble round robin con 4 equipos = 6 fechas de 2 partidos.
  const gen = await admin.post('/admin/fixture/generar', { tournament_id: tournamentId, mode: 'double' });
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

  it('el día de cada fecha cae en el día de juego elegido (sábado)', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);
    const html = await (await admin.get('/admin/fechas')).text();
    // Inicio lunes 2026-10-05 → con día de juego sábado: 2026-10-10 y 2026-10-17.
    expect(html).toContain('value="2026-10-10"');
    expect(html).toContain('value="2026-10-17"');
    expect(html).not.toContain('value="2026-10-05"');
    expect(html).toContain('Fecha 1');
    expect(html).toContain('Fecha 2');
  });

  it('regenerar una fecha: re-slotea hora y cancha y corre el día', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    // El id del partido sale de los inputs de la propia página de Fechas.
    const before = await (await admin.get('/admin/fechas')).text();
    const mid = /name="d_(\d+)"/.exec(before)?.[1] ?? '';
    expect(mid, 'la fecha 1 debe tener al menos un partido').toBeTruthy();

    // Edito la fecha 1 a mano (día fijo, hora y cancha cualquiera).
    const save = await admin.post('/admin/fechas/guardar', {
      tournament_id: tournamentId,
      round: '1',
      [`d_${mid}`]: '2026-11-08',
      [`t_${mid}`]: '09:30',
      [`v_${mid}`]: 'Cancha Vieja',
    });
    expect(save.status).toBe(302);

    // Regenero con +1 día: corre el día y vuelve al patrón del torneo.
    const regen = await admin.post('/admin/fechas/regenerar', {
      tournament_id: tournamentId,
      round: '1',
      shift_days: '1',
    });
    expect(regen.status).toBe(302);
    expect(decodeURIComponent(regen.headers.get('location') ?? '')).toContain('Fecha 1 regenerada');

    const html = await (await admin.get('/admin/fechas')).text();
    expect(html).toContain('value="2026-11-09"'); // el día corrió
    expect(html).toContain('value="10:00"'); // patrón del torneo (10:00 / Cancha Norte)
    expect(html).toContain('Cancha Norte');
    expect(html).not.toContain('Cancha Vieja'); // lo editado a mano se re-sloteó

    // Regenerar sin correr el día no mueve la fecha.
    const again = await admin.post('/admin/fechas/regenerar', {
      tournament_id: tournamentId,
      round: '1',
      shift_days: '0',
    });
    expect(again.status).toBe(302);
    const html2 = await (await admin.get('/admin/fechas')).text();
    expect(html2).toContain('value="2026-11-09"');
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

  it('avisa si las canchas y horarios no alcanzan para alguna fecha', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    // Con la config completa (2 canchas × 2 horarios = 4 slots, 2 partidos
    // por fecha) no hay aviso.
    const okHtml = await (await admin.get('/admin/fixture')).text();
    expect(okHtml).not.toContain('no alcanzan');

    // Dejo 1 cancha × 1 horario = 1 slot por fecha, para fechas de 2 partidos.
    const edit = await admin.post(`/admin/torneos/${tournamentId}`, {
      name: 'Copa E2E',
      season: '2026',
      format: 'round_robin',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      play_weekday: '6',
    });
    expect(edit.status).toBe(302);

    const html = await (await admin.get('/admin/fixture')).text();
    expect(html).toContain('warning-box');
    expect(html).toContain('no alcanzan');
    expect(html).toContain('1 slot(s) por fecha');
    expect(html).toContain('fecha 1');
    expect(html).toContain('2 partidos');
    expect(html).toContain('slot falta');

    // Dejo la config como estaba para los tests siguientes.
    const restore = await admin.post(`/admin/torneos/${tournamentId}`, {
      name: 'Copa E2E',
      season: '2026',
      format: 'round_robin',
      status: 'active',
      venues: 'Cancha Norte\nCancha Sur',
      kickoffs: '10:00, 12:00',
      start_date: '2026-10-05',
      round_gap: '7',
      play_weekday: '6',
    });
    expect(restore.status).toBe(302);
  });

  it('hora y cancha por lista desplegable y regeneración sin choques', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    const page = await (await admin.get('/admin/fechas')).text();
    // La hora y la cancha salen de listas armadas con la config del torneo.
    expect(page).toContain('<select name="t_');
    expect(page).toContain('<select name="v_');
    expect(page).toContain('>12:00</option>');
    expect(page).toContain('>Cancha Sur</option>');

    // Ids: [f1m1, f1m2, f2m1, …]; el día de la fecha 1 sale del input.
    const mIds = [...page.matchAll(/name="d_(\d+)"/g)].map((m) => m[1]!);
    expect(mIds.length).toBeGreaterThanOrEqual(4);
    const r1m1 = mIds[0]!;
    const r2m1 = mIds[2]!;
    const day1 = new RegExp(`name="d_${r1m1}" value="([\\d-]+)"`).exec(page)?.[1] ?? '';
    expect(day1, 'la fecha 1 debe tener día').toBeTruthy();

    const fullConfig = {
      name: 'Copa E2E',
      season: '2026',
      format: 'round_robin',
      status: 'active',
      venues: 'Cancha Norte\nCancha Sur',
      kickoffs: '10:00, 12:00',
      start_date: '2026-10-05',
      round_gap: '7',
      play_weekday: '6',
    };

    // El finally restaura la config completa aunque cualquier expect falle:
    // la configuración compartida no debe arrastrarse a los tests siguientes.
    try {
      // Le doy el día y el slot de la fecha 1 a un partido de la fecha 2.
      const clash = await admin.post('/admin/fechas/guardar', {
        tournament_id: tournamentId,
        round: '2',
        [`d_${r2m1}`]: day1,
        [`t_${r2m1}`]: '10:00',
        [`v_${r2m1}`]: 'Cancha Norte',
      });
      expect(clash.status).toBe(302);

      // Regenerar la fecha 1 esquiva ese slot: mismo día, pero otra hora/cancha.
      const regen = await admin.post('/admin/fechas/regenerar', {
        tournament_id: tournamentId,
        round: '1',
        shift_days: '0',
      });
      expect(regen.status).toBe(302);
      const loc = decodeURIComponent(regen.headers.get('location') ?? '');
      expect(loc).toContain('Fecha 1 regenerada');
      expect(loc).toContain('Sin choques');

      // Con 1 cancha × 1 horario el choque es inevitable: se avisa con detalle.
      const tight = await admin.post(`/admin/torneos/${tournamentId}`, {
        name: 'Copa E2E',
        season: '2026',
        format: 'round_robin',
        status: 'active',
        venues: 'Cancha Norte',
        kickoffs: '10:00',
        start_date: '2026-10-05',
        round_gap: '7',
        play_weekday: '6',
      });
      expect(tight.status).toBe(302);
      const regen2 = await admin.post('/admin/fechas/regenerar', {
        tournament_id: tournamentId,
        round: '1',
        shift_days: '0',
      });
      expect(regen2.status).toBe(302);
      const loc2 = decodeURIComponent(regen2.headers.get('location') ?? '');
      expect(loc2).toContain('Choques');
      expect(loc2).toContain('Cancha Norte tiene 2 partidos');

      // Restauro la config y regenero para dejar el calendario sin choques.
      const restore = await admin.post(`/admin/torneos/${tournamentId}`, fullConfig);
      expect(restore.status).toBe(302);
      const regen3 = await admin.post('/admin/fechas/regenerar', {
        tournament_id: tournamentId,
        round: '1',
        shift_days: '0',
      });
      expect(regen3.status).toBe(302);
      expect(decodeURIComponent(regen3.headers.get('location') ?? '')).toContain('Sin choques');
    } finally {
      await admin.post(`/admin/torneos/${tournamentId}`, fullConfig);
      await admin.post('/admin/fechas/regenerar', {
        tournament_id: tournamentId,
        round: '1',
        shift_days: '0',
      });
    }
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

describe.skipIf(!has)('e2e: regenerar cruce a mitad de torneo', () => {
  it('equipo nuevo: conserva lo jugado, rearma pendientes y verifica choques', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    // Estado previo: el 3-1 del partido fue aprobado en el flujo delegado.
    const add = await admin.post('/admin/equipos', {
      name: 'Nuevo E2E',
      short_name: 'NUE',
      color: '#8b5cf6',
      active: 'on',
    });
    expect(add.status).toBe(302);

    const res = await admin.post('/admin/fixture/regenerar', {
      tournament_id: tournamentId,
      mode: 'double',
    });
    expect(res.status).toBe(302);
    const loc = decodeURIComponent(res.headers.get('location') ?? '');
    expect(loc).toContain('conservado');
    expect(loc).toContain('pendiente');

    // El flash de verificación llega a la página del fixture.
    const page = await (await admin.get(loc)).text();
    expect(page).toContain('Verificado');
    expect(page).toContain('conservado');
    expect(page).not.toContain('Choques');

    // Lo jugado sigue publicado y el equipo nuevo figura en los cruces.
    const publicHtml = await (await fetch(`${BASE}/`)).text();
    expect(publicHtml).toContain('3 - 1');
    const fx = await (await admin.get('/admin/fixture')).text();
    expect(fx).toContain('Nuevo E2E');

    // El delegado de Deportivo ve los cruces nuevos de su equipo.
    const delegate = client();
    await delegate.loginDelegate(delegateCode);
    const home = await delegate.get('/delegado');
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('Deportivo E2E');
  });
});

describe.skipIf(!has)('e2e: generar fixture no pisa los jugados', () => {
  it('bloquea Generar con resultados cargados y lo jugado sigue publicado', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    // La ruta rechaza: el 3-1 aprobado en el flujo delegado no se borra.
    const gen = await admin.post('/admin/fixture/generar', { tournament_id: tournamentId, mode: 'double' });
    expect(gen.status).toBe(302);
    const loc = decodeURIComponent(gen.headers.get('location') ?? '');
    expect(loc).toContain('partido(s) jugado');
    expect(loc).toContain('Regenerar cruce');

    // La página explica el bloqueo y el botón queda deshabilitado.
    const page = await (await admin.get('/admin/fixture')).text();
    expect(page).toContain('deshabilitado');
    expect(page).toContain('disabled');

    // Lo jugado sigue publicado en el sitio.
    const publicHtml = await (await fetch(`${BASE}/`)).text();
    expect(publicHtml).toContain('3 - 1');
  });
});

describe.skipIf(!has)('e2e: fair play y valla en posiciones', () => {
  const form = (extra: Record<string, string> = {}) => ({
    name: 'Copa E2E',
    season: '2026',
    format: 'round_robin',
    status: 'active',
    venues: 'Cancha Norte\nCancha Sur',
    kickoffs: '10:00, 12:00',
    start_date: '2026-10-05',
    round_gap: '7',
    play_weekday: '6',
    ...extra,
  });

  it('columna FP y líderes con tarjetas reales; se ocultan con la regla apagada', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    // Enciendo la regla (los POSTs de otros tests no mandan el checkbox).
    expect((await admin.post(`/admin/torneos/${tournamentId}`, form({ showAdvanced: 'on' }))).status).toBe(302);

    try {
      // Tarjeta real: jugador nuevo y una amarilla en el partido aprobado.
      const add = await admin.post('/admin/jugadores', {
        team_id: teamId,
        name: 'Cardado E2E',
        number: '5',
        position: 'DF',
      });
      expect(add.status).toBe(302);
      const roster = await (await admin.get(`/admin/jugadores?team=${teamId}`)).text();
      const playerId = /\/admin\/jugadores\/(\d+)\/eliminar/.exec(roster)?.[1] ?? '';
      expect(playerId, 'el jugador debe figurar en la plantilla').toBeTruthy();
      const ev = await admin.post(`/admin/planilla/${matchId}/evento`, {
        team_id: teamId,
        player_id: playerId,
        type: 'yellow',
      });
      expect(ev.status).toBe(302);

      // Posiciones con la regla activa: columna FP + líderes de valla y fair play.
      const pos = await (await fetch(`${BASE}/posiciones`)).text();
      expect(pos).toContain('>FP<');
      expect(pos).toContain('1 amarilla(s), 0 roja(s)'); // el desglose del equipo
      expect(pos).toContain('Valla menos vencida');
      expect(pos).toContain('Fair Play:');

      // Apago la regla: la columna y los líderes desaparecen.
      expect((await admin.post(`/admin/torneos/${tournamentId}`, form())).status).toBe(302);
      const off = await (await fetch(`${BASE}/posiciones`)).text();
      expect(off).not.toContain('>FP<');
      expect(off).not.toContain('Valla menos vencida');
    } finally {
      // Dejo la regla activa para lo que siga.
      await admin.post(`/admin/torneos/${tournamentId}`, form({ showAdvanced: 'on' }));
    }
  });
});

describe.skipIf(!has)('e2e: declaración de goles en la planilla', () => {
  it('declara goles con autores, no duplica al repetir y valida autores', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    // Dos goleadores nuevos en la plantilla de Deportivo.
    for (const name of ['Goleador A E2E', 'Goleador B E2E']) {
      const add = await admin.post('/admin/jugadores', { team_id: teamId, name, number: '9', position: 'DEL' });
      expect(add.status).toBe(302);
    }
    const roster = await (await admin.get(`/admin/jugadores?team=${teamId}`)).text();
    const idDe = (name: string) =>
      new RegExp(`${name}[\\s\\S]*?\\/admin\\/jugadores\\/(\\d+)\\/eliminar`).exec(roster)?.[1] ?? '';
    const idA = idDe('Goleador A E2E');
    const idB = idDe('Goleador B E2E');
    expect(idA, 'Goleador A debe estar en la plantilla').toBeTruthy();
    expect(idB, 'Goleador B debe estar en la plantilla').toBeTruthy();

    // La página trae los inputs de goles y las listas de autores (hg/ag).
    const before = await (await admin.get(`/admin/planilla/${matchId}`)).text();
    expect(before).toContain('name="home_goals"');
    expect(before).toContain('name="hg1"');
    expect(before).toContain('name="ag1"');
    expect(before).toContain('data-pick');
    expect(before).toContain('¿Quién hizo los goles?');

    // Declaro 3-1: 2 goles de A, 1 de B; el visitante marca en su arco.
    const payload = {
      status: 'played',
      played_on: '2026-11-09',
      kickoff_time: '10:00',
      venue: 'Cancha Norte',
      home_goals: '3',
      away_goals: '1',
      hg1: idA,
      hg2: idA,
      hg3: idB,
      ag1: 'own',
      notes: '',
    };
    const save = await admin.post(`/admin/planilla/${matchId}`, payload);
    expect(save.status).toBe(302);
    const saveLoc = decodeURIComponent(save.headers.get('location') ?? '');
    expect(saveLoc).toContain('Planilla guardada');

    // La planilla muestra 3-1 y las listas prellenadas con los autores.
    const sheet = await (await admin.get(saveLoc)).text();
    expect(sheet).toMatch(/name="home_goals"[^>]*value="3"/);
    expect(sheet).toMatch(/name="away_goals"[^>]*value="1"/);
    expect(sheet).toMatch(/selected>#9 Goleador A E2E/);

    // La ficha pública: 3-1 con los goleadores (el en contra no tiene autor).
    const ficha = await (await fetch(`${BASE}/partido/${matchId}`)).text();
    expect(ficha).toMatch(/<span>3<\/span><span class="faint">-<\/span><span>1<\/span>/);
    expect(ficha).toContain('Goleador A E2E');
    expect(ficha).toContain('Goleador B E2E');

    // Repetir el guardado con la misma declaración: sigue 3-1 (no 6-2).
    await admin.post(`/admin/planilla/${matchId}`, payload);
    const ficha2 = await (await fetch(`${BASE}/partido/${matchId}`)).text();
    expect(ficha2).toMatch(/<span>3<\/span><span class="faint">-<\/span><span>1<\/span>/);

    // Bajar a 2-0 con otros autores: la declaración reemplaza el paquete.
    await admin.post(`/admin/planilla/${matchId}`, {
      status: 'played',
      played_on: '2026-11-09',
      kickoff_time: '10:00',
      venue: 'Cancha Norte',
      home_goals: '2',
      away_goals: '0',
      hg1: idA,
      hg2: idB,
      notes: '',
    });
    const ficha3 = await (await fetch(`${BASE}/partido/${matchId}`)).text();
    expect(ficha3).toMatch(/<span>2<\/span><span class="faint">-<\/span><span>0<\/span>/);
    expect(ficha3).toContain('Goleador A E2E');
    expect(ficha3).toContain('Goleador B E2E');

    // Validación: 2 goles con 1 autor → error y sin cambios.
    const bad = await admin.post(`/admin/planilla/${matchId}`, {
      status: 'played',
      played_on: '2026-11-09',
      kickoff_time: '10:00',
      venue: 'Cancha Norte',
      home_goals: '2',
      away_goals: '0',
      hg1: idA,
      hg2: '',
      notes: '',
    });
    expect(bad.status).toBe(302);
    const badLoc = decodeURIComponent(bad.headers.get('location') ?? '');
    expect(badLoc).toContain('Completá las listas: falta el autor de 1 gol(es)');
    const sheet4 = await (await admin.get(`/admin/planilla/${matchId}`)).text();
    expect(sheet4).toMatch(/name="home_goals"[^>]*value="2"/);
    expect(sheet4).toMatch(/name="away_goals"[^>]*value="0"/);
  });
});
