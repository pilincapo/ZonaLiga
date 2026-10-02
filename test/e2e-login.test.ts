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
  // Nuevo flujo: previsualizar (guarda borrador) + confirmar (aplica).
  const gen = await admin.post('/admin/fixture/previsualizar', { tournament_id: tournamentId, mode: 'double' });
  expect(gen.status).toBe(302);
  expect(gen.headers.get('location') ?? '').toContain('vista-previa');
  const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: tournamentId, t: 'copa-e2e' });
  expect(conf.status).toBe(302);
  const confLoc = decodeURIComponent(conf.headers.get('location') ?? '');
  expect(confLoc).toContain('Fixture guardado');

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

    // Ids por bloque: cada sección del panel empieza con su encabezado
    // "Fecha N", así que se toman los partidos dentro de cada bloque (el
    // orden de la página no es fijo: ahora sale por cronograma del día).
    const blockOf = (round: number): string => {
      const idx = page.indexOf(`<h3 class="zone-title">Fecha ${round}<`);
      expect(idx, `la fecha ${round} debe figurar en el panel`).toBeGreaterThanOrEqual(0);
      // El bloque llega hasta el próximo encabezado de fecha (o el final).
      const next = page.indexOf('<h3 class="zone-title">Fecha ', idx + 1);
      return page.slice(idx, next === -1 ? undefined : next);
    };
    const idsIn = (round: number): string[] => [...blockOf(round).matchAll(/name="d_(\d+)"/g)].map((m) => m[1]!);
    const r1Ids = idsIn(1);
    const r2Ids = idsIn(2);
    expect(r1Ids.length, 'la fecha 1 debe tener 2 partidos').toBeGreaterThanOrEqual(2);
    expect(r2Ids.length, 'la fecha 2 debe tener partidos').toBeGreaterThanOrEqual(1);
    const r2m1 = r2Ids[0]!;
    const day1 = new RegExp(`name="d_${r1Ids[0]}" value="([\\d-]+)"`).exec(page)?.[1] ?? '';
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
      // Estado controlado: los dos partidos de la fecha 1 en el mismo día
      // (tests anteriores pueden haber movido alguno a otro día) y un partido
      // de la fecha 2 llevado a ese día con el mismo horario y cancha.
      // Sin esto, la fecha 1 repartida en dos días jamás puede chocar.
      const r1Body: Record<string, string> = { tournament_id: tournamentId, round: '1' };
      for (const id of r1Ids) {
        r1Body[`d_${id}`] = day1;
        r1Body[`t_${id}`] = '10:00';
        r1Body[`v_${id}`] = 'Cancha Norte';
      }
      const arrange = await admin.post('/admin/fechas/guardar', r1Body);
      expect(arrange.status).toBe(302);

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
      expect(loc2).toMatch(/Cancha Norte tiene \d+ partidos/);

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

  it('panel de fechas: manijas de arrastre y un intercambio guardado persiste', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    const page = await (await admin.get('/admin/fechas')).text();

    // Toda fila de partido trae su manija de arrastre (⋮⋮).
    const rows = [...page.matchAll(/<tr draggable="true" data-match="(\d+)">/g)];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(page.match(/class="drag-handle"/g)?.length).toBe(rows.length);

    // Valores de día/hora/cancha de una fila, venga select o input libre.
    const parseRow = (html: string, id: string): { d: string; t: string; v: string } => {
      const d = new RegExp(`name="d_${id}" value="([^"]*)"`).exec(html)?.[1] ?? '';
      const t =
        new RegExp(`<select name="t_${id}"[\\s\\S]*?<option value="([^"]*)" selected>`).exec(html)?.[1] ??
        new RegExp(`name="t_${id}" value="([^"]*)"`).exec(html)?.[1] ??
        '';
      const v =
        new RegExp(`<select name="v_${id}"[\\s\\S]*?<option value="([^"]*)" selected>`).exec(html)?.[1] ??
        new RegExp(`name="v_${id}" value="([^"]*)"`).exec(html)?.[1] ??
        '';
      return { d, t, v };
    };

    // Busca una fecha con dos partidos de horario/cancha distintos (si fueran
    // iguales, el intercambio no se podría verificar).
    let round = 0;
    let target: { id: string; d: string; t: string; v: string }[] = [];
    for (let n = 1; n <= 6 && round === 0; n++) {
      const start = page.indexOf(`<h3 class="zone-title">Fecha ${n}<`);
      if (start === -1) continue;
      const next = page.indexOf(`<h3 class="zone-title">Fecha ${n + 1}<`, start);
      const block = page.slice(start, next === -1 ? undefined : next);
      const parsed = [...block.matchAll(/<tr draggable="true" data-match="(\d+)">([\s\S]*?)<\/tr>/g)].map((m) => ({
        id: m[1]!,
        ...parseRow(page, m[1]!),
      }));
      if (parsed.length >= 2 && (parsed[0]!.t !== parsed[1]!.t || parsed[0]!.v !== parsed[1]!.v)) {
        round = n;
        target = parsed;
      }
    }
    expect(round, 'debe haber una fecha con dos partidos distinguibles').toBeGreaterThan(0);
    const ra = target[0]!;
    const rb = target[1]!;

    // El guardado es el mismo endpoint que alimenta el arrastre: se envían
    // TODOS los partidos de la fecha (la ruta pisa con vacío lo que falte).
    const body = (pairs: { id: string; d: string; t: string; v: string }[]): Record<string, string> => {
      const out: Record<string, string> = { tournament_id: tournamentId, round: String(round) };
      for (const p of pairs) {
        out[`d_${p.id}`] = p.d;
        out[`t_${p.id}`] = p.t;
        out[`v_${p.id}`] = p.v;
      }
      return out;
    };

    // Intercambio: cada uno toma el horario y la cancha del otro.
    const swapped = target.map((p) =>
      p.id === ra.id ? { ...p, t: rb.t, v: rb.v } : p.id === rb.id ? { ...p, t: ra.t, v: ra.v } : p
    );
    expect((await admin.post('/admin/fechas/guardar', body(swapped))).status).toBe(302);

    const after = await (await admin.get('/admin/fechas')).text();
    expect(parseRow(after, ra.id).t).toBe(rb.t);
    expect(parseRow(after, ra.id).v).toBe(rb.v);
    expect(parseRow(after, rb.id).t).toBe(ra.t);
    expect(parseRow(after, rb.id).v).toBe(ra.v);

    // Restaurar el estado original: el intercambio es reversible y los otros
    // tests no deben arrastrar este cambio.
    expect((await admin.post('/admin/fechas/guardar', body(target))).status).toBe(302);
    const restored = await (await admin.get('/admin/fechas')).text();
    expect(parseRow(restored, ra.id).t).toBe(ra.t);
    expect(parseRow(restored, rb.id).v).toBe(rb.v);
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
    // Login admin primero: la localía del partido se lee del panel fixture.
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    // Home del delegado: solo los partidos de su equipo.
    const delegate = client();
    const login = await delegate.loginDelegate(delegateCode);
    expect(login.status).toBe(302);

    const home = await delegate.get('/delegado');
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('Deportivo E2E');

    // Elegimos un partido donde Deportivo sea LOCAL: los tests siguientes
    // cargan goles con hg* (autores del local). Con el fixture mezclado, el
    // primer partido del delegado puede ser de visitante. La localía sale
    // del panel del fixture (celda "Deportivo E2E vs …" al inicio de la
    // fila), no de la tarjeta del delegado (que muestra su equipo primero).
    const fixtureHtml = await (await admin.get('/admin/fixture')).text();
    const filas = fixtureHtml.split('<tr>').slice(1);
    const filaLocal = filas.find((f) => /<td>Deportivo E2E <span class="faint">vs/.test(f));
    matchId = /href="\/admin\/planilla\/(\d+)"/.exec(filaLocal ?? '')?.[1] ?? '';
    expect(matchId, 'debe haber un partido con Deportivo de local').toBeTruthy();

    // Carga el resultado 3-1.
    const submit = await delegate.post(`/delegado/partido/${matchId}`, {
      status: 'played',
      home_goals: '3',
      away_goals: '1',
    });
    expect(submit.status).toBe(302);

    // Bandeja del admin: la entrega pendiente aparece con el equipo.
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
    // Camino real de dos pasos: previsualizar (crea borrador) y confirmar.
    const prev = await admin.post('/admin/fixture/previsualizar', { tournament_id: tournamentId, mode: 'double' });
    expect(prev.status).toBe(302);
    const gen = await admin.post('/admin/fixture/confirmar', { tournament_id: tournamentId, t: 'copa-e2e' });
    expect(gen.status).toBe(302);
    const loc = decodeURIComponent(gen.headers.get('location') ?? '');
    expect(loc).toContain('partido(s) jugado');

    // La página explica el bloqueo y el botón queda deshabilitado.
    const page = await (await admin.get('/admin/fixture')).text();
    expect(page).toContain('deshabilitado para no pisarlos');
    expect(page).toContain('disabled');

    // Lo jugado sigue publicado en el sitio.
    const publicHtml = await (await fetch(`${BASE}/`)).text();
    expect(publicHtml).toContain('3 - 1');
  });
});

describe.skipIf(!has)('e2e: zonas manuales con canchas compartidas', () => {
  it('torneo propio con 2 zonas: generar marca la zona y posiciones agrupa', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    // Torneo nuevo con zonas activadas en el mismo form de creación.
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const allIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!);
    const form: Record<string, string> = {
      name: 'Copa Zonas E2E',
      season: '2026',
      format: 'round_robin',
      // draft: no compite por el default de /posiciones (tests de fair play).
      status: 'draft',
      venues: 'Cancha Norte\nCancha Sur',
      kickoffs: '10:00, 12:00',
      start_date: '2026-10-05',
      round_gap: '7',
      play_weekday: '6',
      zones_enabled: 'on',
      zone_names: 'Zona E2E A\nZona E2E B',
    };
    allIds.forEach((id, i) => {
      form[`zone_of_${id}`] = i % 2 === 0 ? '1' : '2';
    });
    const create = await admin.post('/admin/torneos', form);
    expect(create.status).toBe(302);

    // El id del torneo nuevo sale del form de generación del fixture.
    const fxPage = await (await admin.get('/admin/fixture?t=copa-zonas-e2e')).text();
    const zonasId = /name="tournament_id" value="(\d+)"/.exec(fxPage)?.[1] ?? '';
    expect(zonasId, 'el torneo de zonas debe existir').toBeTruthy();

    // Generar (2 pasos): con zonas activas no hay cruces entre zonas y la zona queda en el partido.
    const gen = await admin.post('/admin/fixture/previsualizar', { tournament_id: zonasId, mode: 'single' });
    expect(gen.status).toBe(302);
    const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: zonasId, t: 'copa-zonas-e2e' });
    const genLoc = decodeURIComponent(conf.headers.get('location') ?? '');
    expect(genLoc).not.toContain('err=');
    const fixtureHtml = await (await admin.get('/admin/fixture?t=copa-zonas-e2e')).text();
    expect(fixtureHtml).toContain('Zona E2E A');
    expect(fixtureHtml).toContain('Zona E2E B');

    // Posiciones públicas agrupan por zona.
    const pub = await (await admin.get('/posiciones?t=copa-zonas-e2e')).text();
    expect(pub).toContain('Zona E2E A');
    expect(pub).toContain('Zona E2E B');
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
    // Fase 17: bajar el marcador con autores cargados pide confirmación.
    const bajaSinConfirmar = await admin.post(`/admin/planilla/${matchId}`, {
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
    expect(decodeURIComponent(bajaSinConfirmar.headers.get('location') ?? '')).toContain('casilla de confirmación');
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
      confirm_goles: '1',
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

describe.skipIf(!has)('e2e: cruce solo desde el generador de fixture', () => {
  // Id del torneo de cruce, compartido entre los tests del describe (el
  // primero lo crea y lo guarda; los siguientes lo reutilizan).
  let tidCruce = '';

  it('la seccion manual de cruce ya no existe y el generador declara el cruce', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    // Torneo de zonas propio, para no pisar el estado de los otros tests.
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const allIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!);
    expect(allIds.length).toBeGreaterThanOrEqual(4);
    const form: Record<string, string> = {
      name: 'Copa Cruce E2E',
      season: '2026',
      format: 'round_robin',
      status: 'active',
      venues: 'Cancha Norte\nCancha Sur',
      kickoffs: '10:00, 12:00',
      start_date: '2026-10-05',
      round_gap: '7',
      play_weekday: '6',
      zones_enabled: 'on',
      zone_names: 'Zona Cruce A\nZona Cruce B',
    };
    allIds.forEach((id, i) => {
      form[`zone_of_${id}`] = i % 2 === 0 ? '1' : '2';
    });
    expect((await admin.post('/admin/torneos', form)).status).toBe(302);

    const fxPage = await (await admin.get('/admin/fixture?t=copa-cruce-e2e')).text();
    const tid = /name="tournament_id" value="(\d+)"/.exec(fxPage)?.[1] ?? '';
    expect(tid, 'el torneo de cruce debe existir').toBeTruthy();
    tidCruce = tid;

    // La seccion manual fue removida: no hay form hacia /admin/fixture/cruce.
    expect(fxPage).not.toContain('action="/admin/fixture/cruce"');
    expect(fxPage).not.toContain('Fecha especial de cruce entre zonas');

    // La ruta manual ya no existe: el POST no genera partidos ni registra
    // la fecha en la config (responde 404 o un redirect que no crea nada).
    const manual = await admin.post('/admin/fixture/cruce', { tournament_id: tid, round: '4', rule: 'espejo' });
    expect([302, 404]).toContain(manual.status);

    // El formulario de generar expone las opciones del cruce.
    expect(fxPage).toContain('name="crossover_rule"');
    expect(fxPage).toContain('name="crossover_counts"');
    expect(fxPage).toContain('name="crossover_include"');
    expect(fxPage).toContain('name="crossover_round"');

    // Genero con regla invertido, fecha 4 elegida y que sume puntos: el
    // plan incluye los cruces y la fecha queda registrada al confirmar.
    const prev = await admin.post('/admin/fixture/previsualizar', {
      tournament_id: tid,
      mode: 'single',
      crossover_rule: 'invertido',
      crossover_counts: 'on',
      crossover_round: '4',
    });
    expect(prev.status).toBe(302);
    const previewHtml = await (await admin.get('/admin/fixture/vista-previa?t=copa-cruce-e2e')).text();
    expect(previewHtml).toContain('Cruces por fecha');
    expect(previewHtml).toContain('Cruce (cuenta)');

    const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: 'copa-cruce-e2e' });
    expect(conf.status).toBe(302);
    expect(decodeURIComponent(conf.headers.get('location') ?? '')).toContain('Fixture guardado');

    // En la base: los cruces llevan la marca (cuenta) y el resto no.
    const fixtureHtml = await (await admin.get('/admin/fixture?t=copa-cruce-e2e')).text();
    const matchIds = [...new Set([...fixtureHtml.matchAll(/\/admin\/planilla\/(\d+)/g)].map((m) => m[1]!))];
    expect(matchIds.length).toBeGreaterThan(0);
    let cruces = 0;
    let deZona = 0;
    for (const mid of matchIds) {
      const sheet = await (await admin.get(`/admin/planilla/${mid}`)).text();
      const note = /<textarea name="notes"[^>]*>([\s\S]*?)<\/textarea>/.exec(sheet)?.[1] ?? '';
      if (note.includes('cruce entre zonas')) {
        cruces += 1;
        expect(note, `la planilla ${mid} debe marcar el cruce como cuenta`).toContain('(cuenta)');
      } else {
        deZona += 1;
        expect(note, `la planilla ${mid} no debe llevar marca de cruce`).toBe('');
      }
    }
    expect(cruces).toBeGreaterThan(0);
    expect(deZona).toBeGreaterThan(0);

    // El panel muestra el cruce vigente declarado por el generador.
    const after = await (await admin.get('/admin/fixture?t=copa-cruce-e2e')).text();
    expect(after).toContain('Cruce vigente: fecha 4');
  });

  it('fecha de cruce automatica: cae en la primera libre tras las fechas de zona', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    const prev = await admin.post('/admin/fixture/previsualizar', {
      tournament_id: tidCruce,
      mode: 'single',
      crossover_rule: 'espejo',
      // crossover_round vacio: automatica.
    });
    expect(prev.status).toBe(302);
    const previewHtml = await (await admin.get('/admin/fixture/vista-previa?t=copa-cruce-e2e')).text();
    expect(previewHtml).toContain('Cruces por fecha');
    // Sin fecha elegida, el cruce se coloca solo.
    expect(previewHtml).not.toContain('err=');

    const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: tidCruce, t: 'copa-cruce-e2e' });
    expect(conf.status).toBe(302);
    expect(decodeURIComponent(conf.headers.get('location') ?? '')).toContain('Fixture guardado');
  });

  it('generar con "sin cruces": no hay cruces y la config de fechas se limpia', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    const prev = await admin.post('/admin/fixture/previsualizar', {
      tournament_id: tidCruce,
      mode: 'single',
      crossover_include: 'sin',
    });
    expect(prev.status).toBe(302);
    const previewHtml = await (await admin.get('/admin/fixture/vista-previa?t=copa-cruce-e2e')).text();
    expect(previewHtml).not.toContain('Cruces por fecha');

    const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: tidCruce, t: 'copa-cruce-e2e' });
    expect(conf.status).toBe(302);
    expect(decodeURIComponent(conf.headers.get('location') ?? '')).toContain('Fixture guardado');

    // En la base: ninguna planilla lleva marca de cruce.
    const fixtureHtml = await (await admin.get('/admin/fixture?t=copa-cruce-e2e')).text();
    const matchIds = [...new Set([...fixtureHtml.matchAll(/\/admin\/planilla\/(\d+)/g)].map((m) => m[1]!))];
    expect(matchIds.length).toBeGreaterThan(0);
    for (const mid of matchIds) {
      const sheet = await (await admin.get(`/admin/planilla/${mid}`)).text();
      const note = /<textarea name="notes"[^>]*>([\s\S]*?)<\/textarea>/.exec(sheet)?.[1] ?? '';
      expect(note, `la planilla ${mid} no debe llevar marca de cruce`).not.toContain('cruce entre zonas');
    }
    // La config quedo sin declaracion: el panel no muestra cruce vigente.
    expect(fixtureHtml).not.toContain('Cruce vigente');
  });

  it('participación: crear con participantes, editar quitando/agregando, zonas intactas y sin duplicados', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    // Torneo nuevo con 3 de los 4 equipos marcados como participantes.
    // Los ids se buscan POR NOMBRE dentro de la tarjeta: otros tests crean
    // equipos extra y el orden del listado no es confiable.
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const idOf = (name: string) => {
      const chunk = teamsHtml.split('<article').find((c) => c.includes(name)) ?? '';
      return /href="\/admin\/equipos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '';
    };
    const a = idOf('Deportivo E2E');
    const b = idOf('Atlético E2E');
    const c = idOf('Villa E2E');
    const d = idOf('Norte E2E');
    expect(a && b && c && d, 'los 4 equipos E2E deben estar en el listado').toBeTruthy();
    const creado = await admin.post('/admin/torneos', {
      name: 'Participación E2E',
      season: '2026',
      format: 'round_robin',
      status: 'draft',
      [`participate_${a}`]: 'on',
      [`participate_${b}`]: 'on',
      [`participate_${c}`]: 'on',
    });
    expect(creado.status).toBe(302);

    // El id del torneo nuevo sale de su tarjeta en el listado. El nombre
    // también aparece en el selector del encabezado (chunk sin "Editar"),
    // así que se queda con el primer chunk que tenga el nombre Y el link.
    const listado = await (await admin.get('/admin/torneos')).text();
    const tidPart =
      listado
        .split('<article')
        .filter((chunk) => chunk.includes('Participación E2E'))
        .map((chunk) => /href="\/admin\/torneos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '')
        .find(Boolean) ?? '';
    expect(tidPart, 'el torneo de participación debe estar en el listado').toBeTruthy();

    // Formulario al editar: los 3 marcados con su casilla encendida.
    const form1 = await (await admin.get(`/admin/torneos/${tidPart}`)).text();
    expect(form1).toContain(`name="participate_${a}" data-participate checked`);
    expect(form1).toContain(`name="participate_${b}" data-participate checked`);
    expect(form1).toContain(`name="participate_${c}" data-participate checked`);
    expect(form1).not.toContain(`name="participate_${d}" data-participate checked`);

    // Editar: quitamos a c y agregamos a d. El form postea SOLO los encendidos
    // (como hace el navegador con los checkboxes).
    const edit = await admin.post(`/admin/torneos/${tidPart}`, {
      name: 'Participación E2E',
      season: '2026',
      format: 'round_robin',
      status: 'draft',
      [`participate_${a}`]: 'on',
      [`participate_${b}`]: 'on',
      [`participate_${d}`]: 'on',
    });
    expect(edit.status).toBe(302);

    // Al reabrir el formulario, el estado persistido refleja el cambio.
    const form2 = await (await admin.get(`/admin/torneos/${tidPart}`)).text();
    expect(form2).toContain(`name="participate_${a}" data-participate checked`);
    expect(form2).toContain(`name="participate_${b}" data-participate checked`);
    expect(form2).toContain(`name="participate_${d}" data-participate checked`);
    expect(form2).not.toContain(`name="participate_${c}" data-participate checked`);

    // Sin duplicados: al re-guardar lo mismo, el estado no cambia.
    const reedit = await admin.post(`/admin/torneos/${tidPart}`, {
      name: 'Participación E2E',
      season: '2026',
      format: 'round_robin',
      status: 'draft',
      [`participate_${a}`]: 'on',
      [`participate_${b}`]: 'on',
      [`participate_${d}`]: 'on',
    });
    expect(reedit.status).toBe(302);
    const form3 = await (await admin.get(`/admin/torneos/${tidPart}`)).text();
    expect(form3).toContain(`name="participate_${a}" data-participate checked`);
    expect(form3).toContain(`name="participate_${b}" data-participate checked`);
    expect(form3).toContain(`name="participate_${d}" data-participate checked`);
    expect(form3).not.toContain(`name="participate_${c}" data-participate checked`);

    // Zonas: con 2 zonas activas y equipos asignados, la zona se conserva y
    // el equipo con zona queda como participante aunque su casilla venga apagada.
    const conZonas = await admin.post(`/admin/torneos/${tidPart}`, {
      name: 'Participación E2E',
      season: '2026',
      format: 'zonas_playoffs',
      status: 'draft',
      zones_enabled: 'on',
      zone_names: 'A\nB',
      [`zone_of_${a}`]: '1',
      [`zone_of_${b}`]: '1',
      [`zone_of_${c}`]: '2',
      [`zone_of_${d}`]: '2',
      [`participate_${a}`]: 'on',
    });
    expect(conZonas.status).toBe(302);
    const formZonas = await (await admin.get(`/admin/torneos/${tidPart}`)).text();
    // Con zonas activas, todos los que tienen zona asignada quedan como
    // participantes (la zona conserva al equipo aunque su casilla venga
    // desmarcada); las zonas quedaron seleccionadas en el form.
    for (const id of [a, b, c, d]) {
      expect(formZonas).toContain(`name="participate_${id}" data-participate checked`);
    }
    expect(formZonas).toMatch(new RegExp(`name="zone_of_${c}"[^>]*>[\\s\\S]*?value="2" selected`));
    expect(formZonas).toMatch(new RegExp(`name="zone_of_${d}"[^>]*>[\\s\\S]*?value="2" selected`));
  });

  it('partido manual y ajustes muestran solo participantes; participante sin zona queda detectado', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    // Ids por nombre de tarjeta (los mismos equipos del beforeAll).
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const idOf = (name: string) => {
      const chunk = teamsHtml.split('<article').find((x) => x.includes(name)) ?? '';
      return /href="\/admin\/equipos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '';
    };
    const a = idOf('Deportivo E2E');
    const d = idOf('Norte E2E');
    expect(a && d).toBeTruthy();

    // Torneo con SOLO Deportivo E2E y Norte E2E como participantes.
    const creado = await admin.post('/admin/torneos', {
      name: 'Filtro E2E',
      season: '2026',
      format: 'round_robin',
      status: 'draft',
      [`participate_${a}`]: 'on',
      [`participate_${d}`]: 'on',
    });
    expect(creado.status).toBe(302);
    const listado = await (await admin.get('/admin/torneos')).text();
    const tidFiltro =
      listado
        .split('<article')
        .filter((chunk) => chunk.includes('Filtro E2E'))
        .map((chunk) => /href="\/admin\/torneos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '')
        .find(Boolean) ?? '';
    expect(tidFiltro).toBeTruthy();

    // PARTIDO MANUAL: el form del torneo elegido solo ofrece a sus
    // participantes (ni Atlético ni Villa, que existen globalmente).
    const matchForm = await (await admin.get(`/admin/fixture/nuevo?t=filtro-e2e`)).text();
    const selHome = /<select name="home_team_id">([\s\S]*?)<\/select>/.exec(matchForm)?.[1] ?? '';
    expect(selHome).toContain(`value="${a}"`);
    expect(selHome).toContain(`value="${d}"`);
    expect(selHome).not.toContain('Atlético E2E');
    expect(selHome).not.toContain('Villa E2E');
    expect(matchForm).toContain('match-teams-data');

    // La guardia del server también rechaza un POST con un no participante.
    const ajeno = idOf('Atlético E2E');
    const postAjeno = await admin.post('/admin/fixture/nuevo', {
      tournament_id: tidFiltro,
      home_team_id: a,
      away_team_id: ajeno,
      status: 'scheduled',
    });
    expect(postAjeno.status).toBe(302);

    // AJUSTES: el select lista solo participantes y el POST rechaza al ajeno.
    const ajustesHtml = await (await admin.get('/admin/ajustes?t=filtro-e2e')).text();
    const selAdj = /<select id="adj-team" name="team_id"[^>]*>([\s\S]*?)<\/select>/.exec(ajustesHtml)?.[1] ?? '';
    expect(selAdj).toContain(`value="${a}"`);
    expect(selAdj).toContain(`value="${d}"`);
    expect(selAdj).not.toContain(`value="${ajeno}"`);

    const ajusteAjeno = await admin.post('/admin/ajustes?t=filtro-e2e', {
      team_id: ajeno,
      delta: '-3',
      reason: 'no participa',
    });
    expect(ajusteAjeno.status).toBe(302);
    expect(decodeURIComponent(/err=([^&]+)/.exec(ajusteAjeno.headers.get('location') ?? '')?.[1] ?? '')).toContain(
      'no participa de este torneo'
    );

    // Un ajuste a un participante real sí se aplica.
    const ajusteOk = await admin.post('/admin/ajustes?t=filtro-e2e', {
      team_id: a,
      delta: '-2',
      reason: 'Prueba de ajuste a participante',
    });
    expect(ajusteOk.status).toBe(302);
    expect(decodeURIComponent(ajusteOk.headers.get('location') ?? '')).toContain('aplicado');

    // SIN ZONA: con zonas activas y un participante sin asignar, el formulario
    // del torneo lo detecta explícitamente (aviso) y el generador lo rechaza.
    const conZonas = await admin.post(`/admin/torneos/${tidFiltro}`, {
      name: 'Filtro E2E',
      season: '2026',
      format: 'zonas_playoffs',
      status: 'draft',
      zones_enabled: 'on',
      zone_names: 'A\nB',
      [`zone_of_${a}`]: '1',
      [`zone_of_${d}`]: '2',
      [`participate_${a}`]: 'on',
      [`participate_${d}`]: 'on',
    });
    expect(conZonas.status).toBe(302);
    const formSinZona = await (await admin.get(`/admin/torneos/${tidFiltro}`)).text();
    expect(formSinZona).not.toContain('Participan sin zona');

    // Ahora agrego un tercer participante SIN zona: el aviso aparece.
    const conTercero = await admin.post(`/admin/torneos/${tidFiltro}`, {
      name: 'Filtro E2E',
      season: '2026',
      format: 'zonas_playoffs',
      status: 'draft',
      zones_enabled: 'on',
      zone_names: 'A\nB',
      [`zone_of_${a}`]: '1',
      [`zone_of_${d}`]: '2',
      [`participate_${a}`]: 'on',
      [`participate_${d}`]: 'on',
      [`participate_${ajeno}`]: 'on',
    });
    expect(conTercero.status).toBe(302);
    const formAviso = await (await admin.get(`/admin/torneos/${tidFiltro}`)).text();
    expect(formAviso).toContain('Participan sin zona');
    expect(formAviso).toContain('Atlético E2E');
    // La participación del tercero quedó guardada igual (no se elimina sola).
    expect(formAviso).toContain(`name="participate_${ajeno}" data-participate checked`);

    // El generador avisa y no genera (evita dejarlo fuera silenciosamente).
    const gen = await admin.post('/admin/fixture/previsualizar', { tournament_id: tidFiltro, mode: 'single' });
    expect(decodeURIComponent(gen.headers.get('location') ?? '')).toContain('Participan sin zona');

    // PARTICIPANTE CON ZONA: asignada la zona que faltaba, todo funciona.
    const reparado = await admin.post(`/admin/torneos/${tidFiltro}`, {
      name: 'Filtro E2E',
      season: '2026',
      format: 'zonas_playoffs',
      status: 'draft',
      zones_enabled: 'on',
      zone_names: 'A\nB',
      [`zone_of_${a}`]: '1',
      [`zone_of_${d}`]: '2',
      [`zone_of_${ajeno}`]: '1',
      [`participate_${a}`]: 'on',
      [`participate_${d}`]: 'on',
      [`participate_${ajeno}`]: 'on',
    });
    expect(reparado.status).toBe(302);
    const formOk = await (await admin.get(`/admin/torneos/${tidFiltro}`)).text();
    expect(formOk).not.toContain('Participan sin zona');
    const genOk = await admin.post('/admin/fixture/previsualizar', { tournament_id: tidFiltro, mode: 'single' });
    expect(decodeURIComponent(genOk.headers.get('location') ?? '')).toContain('vista-previa');
  });

  it('sanciones: alta real, aparece combinada con origen manual, anulación con motivo y sin motivo falla', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    // El torneo principal (beforeAll) y su equipo Deportivo E2E con jugadores.
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const chunk = teamsHtml.split('<article').find((x) => x.includes('Deportivo E2E')) ?? '';
    const teamA = /href="\/admin\/equipos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '';
    expect(teamA).toBeTruthy();

    // Cargar un jugador a ese equipo (la plantilla arranca vacía en la D1 e2e)
    // y encontrarlo por su ficha pública, donde el id es explícito.
    const jug = await admin.post('/admin/jugadores', { team_id: teamA, name: 'Sancionado E2E', number: '9' });
    expect(jug.status).toBe(302);
    const equiposHtml = await (await admin.get('/admin/equipos')).text();
    const chunkA = equiposHtml.split('<article').find((x) => x.includes('Deportivo E2E')) ?? '';
    const teamSlug = /href="\/equipos\/([a-z0-9-]+)"/.exec(chunkA)?.[1] ?? '';
    expect(teamSlug, 'el equipo debe tener su slug público').toBeTruthy();
    const teamPublic = await (await admin.get(`/equipos/${teamSlug}`)).text();
    const pid = /href="\/jugador\/(\d+)">Sancionado E2E/.exec(teamPublic)?.[1] ?? '';
    expect(pid, 'el jugador debe existir en la ficha pública').toBeTruthy();

    // Sin motivo de anulación: el POST de anular rechaza (pero primero creamos una).
    // Alta inválida: fechas sin amount → error visible.
    const altaInvalida = await admin.post('/admin/sanciones', {
      t: 'copa-e2e',
      scope: 'player',
      team_id: teamA,
      player_id: pid,
      duration_kind: 'fechas',
      amount: '',
      incident_date: '2026-09-29',
      category: 'Agresión',
    });
    expect(altaInvalida.status).toBe(302);
    expect(decodeURIComponent(/err=([^&]+)/.exec(altaInvalida.headers.get('location') ?? '')?.[1] ?? '')).toContain('cantidad');

    // Alta válida: 2 fechas al jugador.
    const alta = await admin.post('/admin/sanciones', {
      t: 'copa-e2e',
      scope: 'player',
      team_id: teamA,
      player_id: pid,
      duration_kind: 'fechas',
      amount: '2',
      incident_date: '2026-09-29',
      category: 'Agresión',
      description: 'Mano violenta fuera del juego',
    });
    expect(alta.status).toBe(302);
    expect(decodeURIComponent(alta.headers.get('location') ?? '')).toContain('Sanción registrada');

    // Aparece en la lista combinada con origen MANUAL, estado ACTIVA y acción Anular.
    const page1 = await (await admin.get('/admin/suspensiones?t=copa-e2e')).text();
    expect(page1).toContain('Sancionado E2E');
    expect(page1).toContain('Agresión');
    expect(page1).toContain('Manual</span>');
    expect(page1).toContain('Activa</span>');
    expect(page1).toMatch(/sanciones\/\d+\/anular/);

    // Anular sin motivo: rechaza y la sanción sigue activa.
    const sanctionId = /sanciones\/(\d+)\/anular/.exec(page1)?.[1] ?? '';
    expect(sanctionId).toBeTruthy();
    const anularSinMotivo = await admin.post(`/admin/sanciones/${sanctionId}/anular`, { t: 'copa-e2e', annul_reason: '   ' });
    expect(anularSinMotivo.status).toBe(302);
    expect(decodeURIComponent(/err=([^&]+)/.exec(anularSinMotivo.headers.get('location') ?? '')?.[1] ?? '')).toContain('motivo');

    // Anular con motivo: va al historial con la razón visible y sale de activas.
    const anular = await admin.post(`/admin/sanciones/${sanctionId}/anular`, {
      t: 'copa-e2e',
      annul_reason: 'Revisión de video: no hubo agresión',
    });
    expect(anular.status).toBe(302);
    expect(decodeURIComponent(anular.headers.get('location') ?? '')).toContain('Sanción anulada');

    const page2 = await (await admin.get('/admin/suspensiones?t=copa-e2e')).text();
    expect(page2).toContain('Historial');
    expect(page2).toContain('Revisión de video: no hubo agresión');
    expect(page2).not.toMatch(new RegExp(`sanciones\\/${sanctionId}\\/anular`)); // ya no se puede anular
    // La sanción anulada no se borra: su nombre sigue (en historial).
    expect(page2).toContain('Sancionado E2E');
  });
});

describe.skipIf(!has)('e2e: elegibilidad por suspensiones', () => {
  it('suspendido marcado en planilla y delegado; evento rechazado en ambos; elegible continúa; anulación habilita', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    // Deportivo E2E + jugador sancionado + jugador control (elegible).
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const chunk = teamsHtml.split('<article').find((x) => x.includes('Deportivo E2E')) ?? '';
    const teamA = /href="\/admin\/equipos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '';
    expect(teamA).toBeTruthy();

    await admin.post('/admin/jugadores', { team_id: teamA, name: 'Inhabilitado E2E', number: '4' });
    await admin.post('/admin/jugadores', { team_id: teamA, name: 'Habilitado E2E', number: '5' });
    const equiposHtml = await (await admin.get('/admin/equipos')).text();
    const chunkA = equiposHtml.split('<article').find((x) => x.includes('Deportivo E2E')) ?? '';
    const teamSlug = /href="\/equipos\/([a-z0-9-]+)"/.exec(chunkA)?.[1] ?? '';
    const teamPublic = await (await admin.get(`/equipos/${teamSlug}`)).text();
    const pidSus = /href="\/jugador\/(\d+)">Inhabilitado E2E/.exec(teamPublic)?.[1] ?? '';
    const pidOk = /href="\/jugador\/(\d+)">Habilitado E2E/.exec(teamPublic)?.[1] ?? '';
    expect(pidSus && pidOk).toBeTruthy();

    // Sanción manual HASTA FECHA al Inhabilitado, con límite lejano: cubre
    // cualquier partido del torneo sin importar su jornada (el fixture fue
    // rearmando por el test de regeneración, así que no dependemos de fechas
    // ni jornadas concretas). El partido evaluado tiene fecha programada, así
    // que el bloqueo por calendario es firme (no "revisar").
    const alta = await admin.post('/admin/sanciones', {
      t: 'copa-e2e',
      scope: 'player',
      team_id: teamA,
      player_id: pidSus,
      duration_kind: 'hasta_fecha',
      until_date: '2027-12-31',
      incident_date: '2026-10-01',
      category: 'Pelea / desmanes',
      description: 'Pelea después del partido',
    });
    expect(alta.status).toBe(302);

    // PLANILLA ADMIN: el suspendido aparece marcado (visible, no disabled)
    // y hay un resumen con su nombre y origen manual.
    const sheet = await (await admin.get(`/admin/planilla/${matchId}`)).text();
    expect(sheet).toContain('🚫 Suspendido');
    expect(sheet).toContain('Inhabilitado E2E');
    expect(sheet).toContain('data-suspended-notice');
    expect(sheet).toContain('Manual: Pelea / desmanes');
    const optSus = new RegExp(`<option value="${pidSus}"[^>]*>[^<]*Inhabilitado E2E[^<]*🚫 Suspendido`).test(sheet);
    expect(optSus, 'el suspendido queda visible y marcado en el select').toBe(true);
    expect(sheet).not.toMatch(new RegExp(`<option value="${pidSus}"[^>]*disabled`));

    // BLOQUEO DURO admin: evento del suspendido rechazado y no insertado.
    const evSus = await admin.post(`/admin/planilla/${matchId}/evento`, {
      team_id: teamA,
      player_id: pidSus,
      type: 'yellow',
    });
    expect(evSus.status).toBe(302);
    expect(decodeURIComponent(/err=([^&]+)/.exec(evSus.headers.get('location') ?? '')?.[1] ?? '')).toContain('suspendido');

    // El jugador ELEGIBLE continúa funcionando: su evento se inserta.
    const evOk = await admin.post(`/admin/planilla/${matchId}/evento`, {
      team_id: teamA,
      player_id: pidOk,
      type: 'goal',
    });
    expect(evOk.status).toBe(302);
    expect(decodeURIComponent(evOk.headers.get('location') ?? '')).not.toContain('err=');
    const sheetAfter = await (await admin.get(`/admin/planilla/${matchId}`)).text();
    expect(sheetAfter).toContain('Habilitado E2E');

    // DELEGADO: login, guarda el resultado (paso 1, crea el envío pendiente
    // que habilita el form de eventos) y recién ahí ve la marca en el select.
    const delegate = client();
    await delegate.loginDelegate(delegateCode);
    const dSubmit = await delegate.post(`/delegado/partido/${matchId}`, {
      status: 'played',
      home_goals: '1',
      away_goals: '0',
    });
    expect(dSubmit.status).toBe(302);
    const dPage = await (await delegate.get(`/delegado/partido/${matchId}`)).text();
    expect(dPage).toContain('🚫 Suspendido');
    expect(dPage).toContain('Inhabilitado E2E');
    expect(dPage).toContain('data-suspended-notice');

    const dEvSus = await delegate.post(`/delegado/partido/${matchId}/evento`, {
      type: 'yellow',
      player_id: pidSus,
    });
    expect(dEvSus.status).toBe(302);
    expect(decodeURIComponent(/err=([^&]+)/.exec(dEvSus.headers.get('location') ?? '')?.[1] ?? '')).toContain('suspendido');

    // El delegado con el jugador elegible sí carga eventos.
    const dEvOk = await delegate.post(`/delegado/partido/${matchId}/evento`, {
      type: 'goal',
      player_id: pidOk,
    });
    expect(dEvOk.status).toBe(302);
    expect(decodeURIComponent(dEvOk.headers.get('location') ?? '')).toContain('Evento agregado');

    // Cancelar el envío del delegado para no dejar estado pendiente.
    await delegate.post(`/delegado/partido/${matchId}/retirar`, {});

    // ANULACIÓN: sin sanción activa, el jugador vuelve a ser elegible y el
    // mismo evento que antes era rechazado ahora se guarda.
    const suspPage = await (await admin.get('/admin/suspensiones?t=copa-e2e')).text();
    const sid = /sanciones\/(\d+)\/anular/.exec(suspPage)?.[1] ?? '';
    expect(sid, 'debe haber una sanción activa con acción Anular').toBeTruthy();
    const anular = await admin.post(`/admin/sanciones/${sid}/anular`, {
      t: 'copa-e2e',
      annul_reason: 'Descargo aceptado por el tribunal',
    });
    expect(anular.status).toBe(302);
    const evPostAnular = await admin.post(`/admin/planilla/${matchId}/evento`, {
      team_id: teamA,
      player_id: pidSus,
      type: 'yellow',
    });
    expect(evPostAnular.status).toBe(302);
    expect(decodeURIComponent(evPostAnular.headers.get('location') ?? '')).not.toContain('err=');
  });
});

describe.skipIf(!has)('e2e: sanciones a equipos (Fase 7B)', () => {
  it('medidas de equipo: pérdida de puntos descuenta en la tabla, expulsión marca al equipo, anulación revierte', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    // Torneo propio para no ensuciar las tablas del torneo principal.
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const ids = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!);
    const teamA = ids[0]!;
    const teamB = ids[1]!;
    expect(teamA && teamB).toBeTruthy();

    const creado = await admin.post('/admin/torneos', {
      name: 'Sanciones Equipo E2E',
      season: '2026',
      format: 'round_robin',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
    });
    expect(creado.status).toBe(302);
    const listado = await (await admin.get('/admin/torneos')).text();
    const tid = listado
      .split('<article')
      .filter((chunk) => chunk.includes('Sanciones Equipo E2E'))
      .map((chunk) => /href="\/admin\/torneos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '')
      .find(Boolean) ?? '';
    expect(tid).toBeTruthy();

    const gen = await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'double' });
    expect(gen.status).toBe(302);
    const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: 'sanciones-equipo-e2e' });
    expect(conf.status).toBe(302);

    // Fixture doble: Deportivo juega varios partidos. Se carga un ganado 2-0
    // para que la pérdida de puntos sea visible en la tabla (3 pts → 0).
    const fxHtml = await (await admin.get('/admin/fixture?t=sanciones-equipo-e2e')).text();
    const matchIds = [...new Set([...fxHtml.matchAll(/\/admin\/planilla\/(\d+)/g)].map((m) => m[1]!))];
    expect(matchIds.length).toBeGreaterThan(0);
    // Encontrar un partido donde el primer equipo sea local (la fila del
    // fixture lo muestra como "<td>Nombre ... vs"). Usamos team_id del form
    // de planilla en su lugar: el roster se resuelve server-side.
    const fila = fxHtml.split('<tr>').find((f) => /planilla\/(\d+)/.test(f) && /<span class="faint">vs<\/span>/.test(f)) ?? '';
    const mid = /planilla\/(\d+)/.exec(fila)?.[1] ?? '';
    expect(mid).toBeTruthy();
    const primerEquipo =
      /<td class="num">\d+<\/td>\s*<td>([A-Za-zÁ-ú0-9 ]+) <span class="faint">vs<\/span>/.exec(fila)?.[1]?.trim() ?? '';
    expect(primerEquipo).toBeTruthy();

    const slugA = /href="\/equipos\/([a-z0-9-]+)"/.exec(
      (await (await admin.get('/admin/equipos')).text()).split('<article').find((x) => x.includes(primerEquipo)) ?? ''
    )?.[1] ?? '';
    const pubA = await (await admin.get(`/equipos/${slugA}`)).text();
    const teamAId = /href="\/admin\/equipos\/(\d+)">Editar/.exec(
      (await (await admin.get('/admin/equipos')).text()).split('<article').find((x) => x.includes(primerEquipo)) ?? ''
    )?.[1] ?? '';
    void pubA;
    void teamA;
    void teamB;
    expect(teamAId).toBeTruthy();

    // Cargar el 2-0 a favor del primer equipo. Los autores van como "Sin
    // autor": si el equipo tiene plantilla y no se envían, el guardado
    // redirige con err= y el partido queda sin cargar (fallo silencioso).
    const guardar = await admin.post(`/admin/planilla/${mid}`, {
      status: 'played',
      played_on: '2026-10-10',
      kickoff_time: '10:00',
      venue: 'Cancha Norte',
      home_goals: '2',
      away_goals: '0',
      hg1: 'none',
      hg2: 'none',
      notes: '',
    });
    expect(guardar.status).toBe(302);
    const guardarLoc = decodeURIComponent(guardar.headers.get('location') ?? '');
    expect(guardarLoc).toContain('Planilla guardada');

    // Puntos ANTES de la sanción: el ganador tiene 3.
    const tablaAntes = await (await admin.get('/posiciones?t=sanciones-equipo-e2e')).text();
    expect(tablaAntes).toMatch(/<strong>3<\/strong>/);

    // Sanción de equipo: pérdida de 3 puntos.
    const alta = await admin.post('/admin/sanciones', {
      t: 'sanciones-equipo-e2e',
      scope: 'team',
      team_id: teamAId,
      measure: 'perdida_puntos',
      amount: '3',
      incident_date: '2026-10-11',
      category: 'Incumplimiento reglamentario',
      description: 'Alineación indebida',
    });
    expect(alta.status).toBe(302);

    // La tabla ahora muestra 0 puntos para ese equipo (3 - 3).
    const tablaDespues = await (await admin.get('/posiciones?t=sanciones-equipo-e2e')).text();
    expect(tablaDespues).not.toMatch(new RegExp(`${primerEquipo}[\\s\\S]{0,300}?<strong>3</strong>`));

    // El panel de suspensiones muestra la medida con su detalle.
    const suspPage = await (await admin.get('/admin/suspensiones?t=sanciones-equipo-e2e')).text();
    expect(suspPage).toContain('Pérdida de puntos');
    expect(suspPage).toContain('(3 pts)');
    expect(suspPage).toContain('Equipo');

    // EXPULSIÓN: segunda sanción al mismo equipo; la tabla lo marca.
    const altaExp = await admin.post('/admin/sanciones', {
      t: 'sanciones-equipo-e2e',
      scope: 'team',
      team_id: teamAId,
      measure: 'expulsion',
      incident_date: '2026-10-12',
      category: 'Incidente grave',
      description: 'Abandono de cancha',
    });
    expect(altaExp.status).toBe(302);
    const tablaExp = await (await admin.get('/posiciones?t=sanciones-equipo-e2e')).text();
    expect(tablaExp).toContain('Expulsado');

    // ADVERTENCIA: aparece con su badge, sin efecto en puntos.
    const altaAdv = await admin.post('/admin/sanciones', {
      t: 'sanciones-equipo-e2e',
      scope: 'team',
      team_id: teamAId,
      measure: 'advertencia',
      incident_date: '2026-10-13',
      category: 'Conducta antideportiva',
      description: 'Cártel en el banco',
    });
    expect(altaAdv.status).toBe(302);
    const suspAdv = await (await admin.get('/admin/suspensiones?t=sanciones-equipo-e2e')).text();
    expect(suspAdv).toContain('Advertencia');

    // ANULACIÓN de la expulsión: la marca desaparece de la tabla. Tomamos el
    // id de la sanción de expulsión (segunda creada, fila con badge rojo) y
    // no de la advertencia: buscamos la fila que contiene "Expulsión".
    const filaExp = suspAdv
      .split('<tr>')
      .find((f) => f.includes('Expulsión del torneo') && /sanciones\/(\d+)\/anular/.test(f)) ?? '';
    const sid = /sanciones\/(\d+)\/anular/.exec(filaExp)?.[1] ?? '';
    expect(sid).toBeTruthy();
    const anular = await admin.post(`/admin/sanciones/${sid}/anular`, {
      t: 'sanciones-equipo-e2e',
      annul_reason: 'Apelación favorable',
    });
    expect(anular.status).toBe(302);
    const tablaPost = await (await admin.get('/posiciones?t=sanciones-equipo-e2e')).text();
    expect(tablaPost).not.toContain('Expulsado');
    // El historial conserva la sanción anulada con su motivo.
    const suspPost = await (await admin.get('/admin/suspensiones?t=sanciones-equipo-e2e')).text();
    expect(suspPost).toContain('Apelación favorable');
  });
});

describe.skipIf(!has)('e2e: cierre automático de sanciones cumplidas (Fase 8)', () => {
  it('suspension_dias vencida se marca cumplida sola; advertencia sigue activa; historial intacto', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const chunk = teamsHtml.split('<article').find((x) => x.includes('Deportivo E2E')) ?? '';
    const teamA = /href="\/admin\/equipos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '';
    expect(teamA).toBeTruthy();

    // 1) Suspension por DÍAS con fecha de fin claramente vencida: la próxima
    //    consulta del panel debe cerrarla sola (hoy de la liga > fin).
    const altaDias = await admin.post('/admin/sanciones', {
      t: 'copa-e2e',
      scope: 'team',
      team_id: teamA,
      measure: 'suspension_dias',
      until_date: '2026-09-01',
      incident_date: '2026-08-15',
      category: 'Incumplimiento reglamentario',
      description: 'Sanción ya vencida al crearla',
    });
    expect(altaDias.status).toBe(302);

    // 2) Advertencia: NO expira, tiene que seguir activa.
    const altaAdv = await admin.post('/admin/sanciones', {
      t: 'copa-e2e',
      scope: 'team',
      team_id: teamA,
      measure: 'advertencia',
      incident_date: '2026-09-20',
      category: 'Conducta antideportiva',
      description: 'Aviso formal del tribunal',
    });
    expect(altaAdv.status).toBe(302);

    // La consulta del panel dispara el cierre automático (Fase 8).
    const page = await (await admin.get('/admin/suspensiones?t=copa-e2e')).text();

    // La de días vencida ya NO figura como activa (pasó a cumplida/historial).
    const filaDias = page.split('<tr>').find((f) => f.includes('Suspensión por días') && f.includes('Deportivo E2E')) ?? '';
    expect(filaDias).toBeTruthy();
    expect(filaDias).toContain('Cumplida');
    expect(filaDias).not.toContain('>Activa<');

    // La advertencia SIGUE activa (no expira).
    const filaAdv = page.split('<tr>').find((f) => f.includes('Advertencia') && f.includes('Deportivo E2E')) ?? '';
    expect(filaAdv).toBeTruthy();
    expect(filaAdv).toContain('>Activa<');

    // Idempotencia: re-consultar no cambia nada ni duplica historial.
    const page2 = await (await admin.get('/admin/suspensiones?t=copa-e2e')).text();
    expect(page2.split('<tr>').filter((f) => f.includes('Suspensión por días')).length).toBe(
      page.split('<tr>').filter((f) => f.includes('Suspensión por días')).length
    );

    // El historial conserva el registro cerrado (nunca se borra): la fila
    // de la sanción de días sigue presente, ahora con estado Cumplida.
    const filaDias2 = page2.split('<tr>').find((f) => f.includes('Suspensión por días') && f.includes('Deportivo E2E')) ?? '';
    expect(filaDias2).toBeTruthy();
    expect(filaDias2).toContain('Cumplida');

    // La elegibilidad no cambia: la sanción de equipo vencida ya no genera
    // aviso de disciplina en la planilla (solo quedan la advertencia, que
    // no se consulta por equipo aquí, y nada activo que bloquee).
    const sheet = await (await admin.get(`/admin/planilla/${matchId}`)).text();
    expect(sheet).not.toContain('Incumplimiento reglamentario');
  });
});

describe.skipIf(!has)('e2e: configuración de competencia (Fase 10)', () => {
  it('alta con formato de grupos + playoffs guarda la config; validaciones rechazan incompatibles; estados bloquean la estructura', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    // 1) ALTA: grupos + playoffs válidos (4 grupos × 2 = 8, cuartos).
    const alta = await admin.post('/admin/torneos', {
      name: 'Competencia E2E',
      season: '2026',
      status: 'draft',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'GRUPOS_PLAYOFFS',
      comp_groups: '4',
      comp_qualifiers: '2',
      comp_playoff_start: 'QF',
      comp_playoff_tiebreak: 'PENALES',
      comp_playoff_single: 'on',
      comp_playoff_third: 'on',
      comp_points_win: '3',
      comp_points_draw: '1',
      comp_points_loss: '0',
      comp_tb_1: 'PUNTOS',
      comp_tb_2: 'DIFERENCIA_GOLES',
      comp_tb_3: 'GOLES_FAVOR',
      comp_localia: 'ALTERNADA',
    });
    expect(alta.status).toBe(302);
    const listado = await (await admin.get('/admin/torneos')).text();
    const tid = listado
      .split('<article')
      .filter((chunk) => chunk.includes('Competencia E2E'))
      .map((chunk) => /href="\/admin\/torneos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '')
      .find(Boolean) ?? '';
    expect(tid).toBeTruthy();

    // El form muestra la config guardada y el formato en el selector nuevo.
    const form = await (await admin.get(`/admin/torneos/${tid}`)).text();
    expect(form).toContain('value="GRUPOS_PLAYOFFS" selected');
    expect(form).toContain('name="comp_groups" value="4"');
    expect(form).toContain('name="comp_playoff_start"');
    expect(form).toContain('Inscripciones');

    // 2) VALIDACIÓN: cuartos (8) con 2 grupos × 2 clasificados (4) no pasa.
    const mala = await admin.post(`/admin/torneos/${tid}`, {
      name: 'Competencia E2E',
      season: '2026',
      status: 'draft',
      comp_format: 'GRUPOS_PLAYOFFS',
      comp_groups: '2',
      comp_qualifiers: '2',
      comp_playoff_start: 'QF',
      comp_playoff_tiebreak: 'PENALES',
      comp_points_win: '3',
      comp_points_draw: '1',
      comp_points_loss: '0',
    });
    expect(mala.status).toBe(400);
    const malaHtml = await mala.text();
    expect(malaHtml).toContain('menos de los 8');

    // 3) VALIDACIÓN: victoria <= empate no pasa.
    const puntosMala = await admin.post(`/admin/torneos/${tid}`, {
      name: 'Competencia E2E',
      season: '2026',
      status: 'draft',
      comp_format: 'TODOS_CONTRA_TODOS',
      comp_points_win: '1',
      comp_points_draw: '3',
      comp_points_loss: '0',
    });
    expect(puntosMala.status).toBe(400);
    expect(await puntosMala.text()).toContain('mayores que los del empate');

    // 4) BLOQUEO: torneo en activo no cambia su estructura. Primer POST lo
    // pasa a activo (manteniendo estructura); segundo intenta cambiarla.
    const aActivo = await admin.post(`/admin/torneos/${tid}`, {
      name: 'Competencia E2E',
      season: '2026',
      status: 'active',
      comp_format: 'GRUPOS_PLAYOFFS',
      comp_groups: '4',
      comp_qualifiers: '2',
      comp_playoff_start: 'QF',
      comp_playoff_tiebreak: 'PENALES',
      comp_playoff_single: 'on',
      comp_playoff_third: 'on',
      comp_points_win: '3',
      comp_points_draw: '1',
      comp_points_loss: '0',
    });
    expect(aActivo.status).toBe(302);
    const bloqueo = await admin.post(`/admin/torneos/${tid}`, {
      name: 'Competencia E2E',
      season: '2026',
      status: 'active',
      comp_format: 'ELIMINACION_DIRECTA', // cambio estructural: rechazado
      comp_playoff_start: 'F',
      comp_playoff_tiebreak: 'PENALES',
    });
    expect(bloqueo.status).toBe(400);
    expect(await bloqueo.text()).toContain('queda congelada');

    // 5) NO estructural en activo: ajustar puntos sí pasa.
    const puntos = await admin.post(`/admin/torneos/${tid}`, {
      name: 'Competencia E2E',
      season: '2026',
      status: 'active',
      comp_format: 'GRUPOS_PLAYOFFS', // misma estructura
      comp_groups: '4',
      comp_qualifiers: '2',
      comp_playoff_start: 'QF',
      comp_playoff_tiebreak: 'PENALES',
      comp_playoff_single: 'on',
      comp_playoff_third: 'on',
      comp_points_win: '2',
      comp_points_draw: '1',
      comp_points_loss: '0',
    });
    expect(puntos.status).toBe(302);
    const form2 = await (await admin.get(`/admin/torneos/${tid}`)).text();
    expect(form2).toContain('name="comp_points_win" value="2"');

    // 6) Limpieza: borrar el torneo de prueba.
    const del = await admin.post(`/admin/torneos/${tid}/eliminar`, {});
    expect(del.status).toBe(302);
  });
});

describe.skipIf(!has)('e2e: generador de fixture por formato (Fase 11A)', () => {
  it('UNA_RUEDA: genera una sola vuelta; regenerar exige acción explícita; los jugados bloquean', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    // Torneo propio con 4 equipos participantes y formato UNA_RUEDA.
    const alta = await admin.post('/admin/torneos', {
      name: 'Fixture Rueda E2E',
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'UNA_RUEDA',
      comp_points_win: '3',
      comp_points_draw: '1',
      comp_points_loss: '0',
    });
    expect(alta.status).toBe(302);
    const listado = await (await admin.get('/admin/torneos')).text();
    const tid = listado
      .split('<article')
      .filter((chunk) => chunk.includes('Fixture Rueda E2E'))
      .map((chunk) => /href="\/admin\/torneos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '')
      .find(Boolean) ?? '';
    expect(tid).toBeTruthy();

    // 4 participantes (los primeros 4 equipos globales, por id real).
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const teamIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!).slice(0, 4);
    expect(teamIds.length).toBe(4);
    const partBody: Record<string, string> = {
      name: 'Fixture Rueda E2E',
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'UNA_RUEDA',
    };
    for (const id of teamIds) partBody[`participate_${id}`] = 'on';
    const part = await admin.post(`/admin/torneos/${tid}`, partBody);
    expect(part.status).toBe(302);

    // Vista previa: el generador muestra el formato definido en el torneo.
    const gen = await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'double' });
    expect(gen.status).toBe(302);
    const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: 'fixture-rueda-e2e' });
    expect(conf.status).toBe(302);
    const confLoc = decodeURIComponent(conf.headers.get('location') ?? '');
    expect(confLoc).toContain('Fixture guardado');

    // Con 4 equipos UNA_RUEDA: 6 partidos (sin doble vuelta). Cada partido
    // se menciona varias veces en el HTML (link de planilla + eliminar), así
    // que se cuenta por IDs únicos presentes en filas de la tabla del fixture.
    const fx = await (await admin.get('/admin/fixture?t=fixture-rueda-e2e')).text();
    const partidos = [...fx.matchAll(/\/admin\/fixture\/(\d+)\/eliminar/g)].map((m) => m[1]!);
    expect(new Set(partidos).size).toBe(6);
    // El generador muestra el formato definido en la config del torneo.
    expect(fx).toContain('Todos contra todos (solo ida)');

    // Regeneración explícita: preparar otra vista previa y confirmar pisa
    // el fixture SIN jugados (acción explícita de dos pasos: previsualizar
    // → confirmar con confirm() en la UI).
    const gen2 = await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'double' });
    expect(gen2.status).toBe(302);
    const conf2 = await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: 'fixture-rueda-e2e' });
    expect(conf2.status).toBe(302);
    expect(decodeURIComponent(conf2.headers.get('location') ?? '')).toContain('Fixture guardado');

    // Cargar un resultado: ahora la regeneración que borre partidos queda
    // bloqueada en el servidor.
    const fx2 = await (await admin.get('/admin/fixture?t=fixture-rueda-e2e')).text();
    const mids = [...new Set([...fx2.matchAll(/\/admin\/fixture\/(\d+)\/eliminar/g)].map((m) => m[1]!))];
    const guardar = await admin.post(`/admin/planilla/${mids[0]}`, {
      status: 'played',
      played_on: '2026-10-05',
      kickoff_time: '10:00',
      venue: 'Cancha Norte',
      home_goals: '2',
      away_goals: '1',
      hg1: 'none',
      hg2: 'none',
      ag1: 'none',
      notes: '',
    });
    expect(guardar.status).toBe(302);
    const gen3 = await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'single' });
    expect(gen3.status).toBe(302);
    const conf3 = await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: 'fixture-rueda-e2e' });
    expect(conf3.status).toBe(302);
    const conf3Loc = decodeURIComponent(conf3.headers.get('location') ?? '');
    expect(conf3Loc).toContain('jugado(s)'); // rechazo explícito: no borra históricos

    // Limpieza.
    const del = await admin.post(`/admin/torneos/${tid}/eliminar`, {});
    expect(del.status).toBe(302);
  });
});

describe.skipIf(!has)('e2e: generador de fixture por grupos (Fase 11B)', () => {
  it('GRUPOS_PLAYOFFS: 6 equipos en 2 grupos, fixture por grupo y aviso de llaves pendientes', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    // Torneo con formato Grupos + Playoffs: 2 grupos × 2 clasificados.
    const alta = await admin.post('/admin/torneos', {
      name: 'Grupos Playoffs E2E',
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'GRUPOS_PLAYOFFS',
      comp_groups: '2',
      comp_qualifiers: '2',
      comp_playoff_start: 'SF',
      comp_playoff_tiebreak: 'PENALES',
      comp_points_win: '3',
      comp_points_draw: '1',
      comp_points_loss: '0',
    });
    expect(alta.status).toBe(302);
    const listado = await (await admin.get('/admin/torneos')).text();
    const tid = listado
      .split('<article')
      .filter((chunk) => chunk.includes('Grupos Playoffs E2E'))
      .map((chunk) => /href="\/admin\/torneos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '')
      .find(Boolean) ?? '';
    expect(tid).toBeTruthy();

    // 6 participantes: crea 2 equipos extra (el beforeAll crea 4).
    await admin.post('/admin/equipos', { name: 'Zonda E2E', short_name: 'ZON', color: '#8b5cf6', active: 'on' });
    await admin.post('/admin/equipos', { name: 'Yerbal E2E', short_name: 'YER', color: '#0ea5e9', active: 'on' });
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const teamIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!).slice(0, 6);
    expect(teamIds.length).toBe(6);
    const partBody: Record<string, string> = {
      name: 'Grupos Playoffs E2E',
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'GRUPOS_PLAYOFFS',
    };
    for (const id of teamIds) partBody[`participate_${id}`] = 'on';
    const part = await admin.post(`/admin/torneos/${tid}`, partBody);
    expect(part.status).toBe(302);

    // Generar (1 rueda): vista previa + confirmar.
    const gen = await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'single' });
    expect(gen.status).toBe(302);

    // La vista previa avisa de los playoffs pendientes (4 clasificados).
    const preview = await (await admin.get('/admin/fixture/vista-previa?t=grupos-playoffs-e2e')).text();
    expect(preview).toContain('clasifican los primeros 2 de cada grupo (4 equipos)');
    expect(preview).toContain('todavía no están implementadas');

    const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: 'grupos-playoffs-e2e' });
    expect(conf.status).toBe(302);
    expect(decodeURIComponent(conf.headers.get('location') ?? '')).toContain('Fixture guardado');

    // 6 equipos en 2 grupos de 3, una rueda: 2 × C(3,2) = 6 partidos.
    const fx = await (await admin.get('/admin/fixture?t=grupos-playoffs-e2e')).text();
    const partidos = [...fx.matchAll(/\/admin\/fixture\/(\d+)\/eliminar/g)].map((m) => m[1]!);
    expect(new Set(partidos).size).toBe(6);
    // Los partidos están marcados con su grupo (A/B) en la columna de zona.
    expect(fx).toContain('>A<');
    expect(fx).toContain('>B<');

    // El torneo quedó con la config de zonas por grupos: posiciones agrupadas.
    const form = await (await admin.get(`/admin/torneos/${tid}`)).text();
    expect(form).toContain('value="GRUPOS_PLAYOFFS" selected');

    // Limpieza.
    const del = await admin.post(`/admin/torneos/${tid}/eliminar`, {});
    expect(del.status).toBe(302);
  });
});

describe.skipIf(!has)('e2e: llaves de playoffs (Fase 11C)', () => {
  it('GRUPOS_PLAYOFFS: juega la fase de grupos, genera llaves SF y protege resultados', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    // Torneo Grupos + Playoffs: 4 equipos, 2 grupos × 2 clasificados, semis.
    const alta = await admin.post('/admin/torneos', {
      name: 'Llaves E2E',
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'GRUPOS_PLAYOFFS',
      comp_groups: '2',
      comp_qualifiers: '2',
      comp_playoff_start: 'SF',
      comp_playoff_single: 'on',
      comp_playoff_tiebreak: 'PENALES',
      comp_points_win: '3',
      comp_points_draw: '1',
      comp_points_loss: '0',
    });
    expect(alta.status).toBe(302);
    const listado = await (await admin.get('/admin/torneos')).text();
    const tid = listado
      .split('<article')
      .filter((chunk) => chunk.includes('Llaves E2E'))
      .map((chunk) => /href="\/admin\/torneos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '')
      .find(Boolean) ?? '';
    expect(tid).toBeTruthy();

    // 4 participantes (los primeros 4 equipos globales).
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const teamIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!).slice(0, 4);
    expect(teamIds.length).toBe(4);
    const partBody: Record<string, string> = {
      name: 'Llaves E2E',
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'GRUPOS_PLAYOFFS',
      comp_groups: '2',
      comp_qualifiers: '2',
      comp_playoff_start: 'SF',
      comp_playoff_single: 'on',
    };
    for (const id of teamIds) partBody[`participate_${id}`] = 'on';
    const part = await admin.post(`/admin/torneos/${tid}`, partBody);
    expect(part.status).toBe(302);

    // Fixture de grupos (1 rueda: 2 partidos, 1 por grupo).
    const gen = await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'single' });
    expect(gen.status).toBe(302);
    const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: 'llaves-e2e' });
    expect(conf.status).toBe(302);

    // Sin jugar la fase de grupos, las llaves están bloqueadas.
    const bloqueado = await admin.post('/admin/fixture/llaves', { tournament_id: tid });
    expect(bloqueado.status).toBe(302);
    expect(decodeURIComponent(bloqueado.headers.get('location') ?? '')).toContain('Faltan');

    // Juega los 2 partidos de grupos: el local siempre gana (posiciones claras).
    const fx = await (await admin.get('/admin/fixture?t=llaves-e2e')).text();
    const mids = [...new Set([...fx.matchAll(/\/admin\/fixture\/(\d+)\/eliminar/g)].map((m) => m[1]!))];
    expect(mids.length).toBe(2);
    for (const mid of mids) {
      const guardar = await admin.post(`/admin/planilla/${mid}`, {
        status: 'played',
        played_on: '2026-10-05',
        kickoff_time: '10:00',
        venue: 'Cancha Norte',
        home_goals: '2',
        away_goals: '0',
        hg1: 'none',
        hg2: 'none',
        ag1: 'none',
        notes: '',
      });
      expect(guardar.status).toBe(302);
    }

    // Genera las llaves: 2 semis (con los 4 clasificados) + final "Por definir".
    const llaves = await admin.post('/admin/fixture/llaves', { tournament_id: tid });
    expect(llaves.status).toBe(302);
    const llavesLoc = decodeURIComponent(llaves.headers.get('location') ?? '');
    expect(llavesLoc).toContain('Llaves generadas');

    const fx2 = await (await admin.get('/admin/fixture?t=llaves-e2e')).text();
    const bracketIds = [
      ...new Set([...fx2.matchAll(/\/admin\/fixture\/(\d+)\/eliminar/g)].map((m) => m[1]!)),
    ].filter((id) => !mids.includes(id));
    expect(bracketIds.length).toBe(3); // 2 SF + 1 F
    expect(fx2).toContain('Llaves / Playoffs');
    expect(fx2).toContain('Semifinales');
    expect(fx2).toContain('Ganador SF');

    // No se puede generar de nuevo sin la acción explícita de regeneración.
    const duplicado = await admin.post('/admin/fixture/llaves', { tournament_id: tid });
    expect(duplicado.status).toBe(302);
    expect(decodeURIComponent(duplicado.headers.get('location') ?? '')).toContain('ya fueron generadas');

    // Se juega una semi: con resultado en la llave, regenerar queda prohibido.
    const sfId = bracketIds[0]!;
    const jugada = await admin.post(`/admin/planilla/${sfId}`, {
      status: 'played',
      played_on: '2026-10-12',
      kickoff_time: '10:00',
      venue: 'Cancha Norte',
      home_goals: '2',
      away_goals: '0',
      hg1: 'none',
      hg2: 'none',
      notes: '',
    });
    expect(jugada.status).toBe(302);
    expect(decodeURIComponent(jugada.headers.get('location') ?? '')).toContain('Planilla guardada');

    const regen = await admin.post('/admin/fixture/llaves', { tournament_id: tid, regenerar: '1' });
    expect(regen.status).toBe(302);
    expect(decodeURIComponent(regen.headers.get('location') ?? '')).toContain('no se puede regenerar');

    // Limpieza.
    const del = await admin.post(`/admin/torneos/${tid}/eliminar`, {});
    expect(del.status).toBe(302);
  });

  it('ELIMINACION_DIRECTA: llave directa con 4 equipos, partido único y tercer puesto', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    // Copa con 4 equipos y arranque en SEMIFINALES (necesita exactamente 4).
    const alta = await admin.post('/admin/torneos', {
      name: 'Copa Llaves E2E',
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'ELIMINACION_DIRECTA',
      comp_playoff_start: 'SF',
      comp_playoff_single: 'on',
      comp_playoff_third: 'on',
    });
    expect(alta.status).toBe(302);
    const listado = await (await admin.get('/admin/torneos')).text();
    const tid = listado
      .split('<article')
      .filter((chunk) => chunk.includes('Copa Llaves E2E'))
      .map((chunk) => /href="\/admin\/torneos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '')
      .find(Boolean) ?? '';
    expect(tid).toBeTruthy();

    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const teamIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!).slice(0, 4);
    expect(teamIds.length).toBe(4);
    const partBody: Record<string, string> = {
      name: 'Copa Llaves E2E',
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'ELIMINACION_DIRECTA',
    };
    for (const id of teamIds) partBody[`participate_${id}`] = 'on';
    await admin.post(`/admin/torneos/${tid}`, partBody);

    // Sin fixture previo: la copa genera las llaves directo.
    const llaves = await admin.post('/admin/fixture/llaves', { tournament_id: tid });
    expect(llaves.status).toBe(302);
    const loc = decodeURIComponent(llaves.headers.get('location') ?? '');
    expect(loc).toContain('Llaves generadas: 4 partido(s)'); // 2 SF + final + 3er puesto

    const fx = await (await admin.get('/admin/fixture?t=copa-llaves-e2e')).text();
    expect(fx).toContain('Llaves / Playoffs');
    expect(fx).toContain('Tercer puesto');
    expect(fx).toContain('Ganador SF');

    // Limpieza.
    const del = await admin.post(`/admin/torneos/${tid}/eliminar`, {});
    expect(del.status).toBe(302);
  });
});

describe.skipIf(!has)('e2e: flujo completo de competencia (Fase 12A)', () => {
  /** Guarda un resultado jugado (goles sin autor: la planilla los acepta como "sin autor"). */
  async function jugar(admin: ReturnType<typeof client>, mid: string, homeGoals: string, awayGoals: string, day: string): Promise<void> {
    const raws: Record<string, string> = {
      status: 'played',
      played_on: day,
      kickoff_time: '10:00',
      venue: 'Cancha Norte',
      home_goals: homeGoals,
      away_goals: awayGoals,
      notes: '',
    };
    for (let i = 1; i <= Number(homeGoals); i++) raws[`hg${i}`] = 'none';
    for (let i = 1; i <= Number(awayGoals); i++) raws[`ag${i}`] = 'none';
    const res = await admin.post(`/admin/planilla/${mid}`, raws);
    expect(res.status).toBe(302);
    const loc = decodeURIComponent(res.headers.get('location') ?? '');
    expect(loc, `planilla ${mid}: ${loc}`).toContain('Planilla guardada');
  }

  /** IDs únicos de partidos en el HTML del fixture. */
  function matchIds(html: string): string[] {
    return [...new Set([...html.matchAll(/\/admin\/fixture\/(\d+)\/eliminar/g)].map((m) => m[1]!))];
  }

  /** Alta de torneo + participantes. Devuelve el id del torneo. */
  async function crearTorneo(
    admin: ReturnType<typeof client>,
    nombre: string,
    slug: string,
    extra: Record<string, string>,
    teamIds: string[]
  ): Promise<string> {
    const alta = await admin.post('/admin/torneos', {
      name: nombre,
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      ...extra,
    });
    expect(alta.status).toBe(302);
    const listado = await (await admin.get('/admin/torneos')).text();
    const tid = listado
      .split('<article')
      .filter((chunk) => chunk.includes(nombre))
      .map((chunk) => /href="\/admin\/torneos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '')
      .find(Boolean) ?? '';
    expect(tid).toBeTruthy();
    const partBody: Record<string, string> = {
      name: nombre,
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      ...extra,
    };
    for (const id of teamIds) partBody[`participate_${id}`] = 'on';
    const part = await admin.post(`/admin/torneos/${tid}`, partBody);
    expect(part.status).toBe(302);
    void slug;
    return tid;
  }

  it('recorrido 1 — UNA_RUEDA: participantes → fixture → resultados → posiciones', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const teamIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!).slice(0, 4);

    const tid = await crearTorneo(admin, '12A Liga E2E', '12a-liga-e2e', {
      comp_format: 'UNA_RUEDA',
      comp_points_win: '3',
      comp_points_draw: '1',
      comp_points_loss: '0',
    }, teamIds);

    // Fixture: 6 partidos (4 equipos, una rueda).
    const gen = await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'single' });
    expect(gen.status).toBe(302);
    const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: '12a-liga-e2e' });
    expect(decodeURIComponent(conf.headers.get('location') ?? '')).toContain('Fixture guardado');

    const fx = await (await admin.get('/admin/fixture?t=12a-liga-e2e')).text();
    const ids = matchIds(fx);
    expect(ids.length).toBe(6);

    // Juega todos los partidos: los locales ganan 1-0 → el que más gana
    // como local encabeza. Con round-robin puro cada equipo es local 2 veces;
    // los desempates deciden el orden.
    for (const [i, mid] of ids.entries()) {
      await jugar(admin, mid, i % 2 === 0 ? '2' : '0', i % 2 === 0 ? '0' : '1', '2026-10-05');
    }

    // La tabla pública refleja la fase regular: 6 partidos jugados, con
    // goles. Los partidos de liga no están marcados con ronda de llave.
    const tabla = await (await admin.get('/posiciones?t=12a-liga-e2e')).text();
    expect(tabla).toContain('12A Liga E2E');
    expect(tabla).toContain('<strong>'); // hay puntos cargados
    // Total de puntos: 3 partidos con ganador por 2-0 y 3 por 0-1 → 18 pts repartidos.
    const pts = [...tabla.matchAll(/<strong>(\d+)<\/strong>/g)].map((m) => Number(m[1]));
    expect(pts.reduce((a, b) => a + b, 0)).toBe(18);

    // Limpieza.
    expect((await admin.post(`/admin/torneos/${tid}/eliminar`, {})).status).toBe(302);
  });

  it('recorrido 2 — GRUPOS_PLAYOFFS: grupos → fixture → resultados → semis → final', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const teamIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!).slice(0, 4);

    const tid = await crearTorneo(admin, '12A Grupos E2E', '12a-grupos-e2e', {
      comp_format: 'GRUPOS_PLAYOFFS',
      comp_groups: '2',
      comp_qualifiers: '2',
      comp_playoff_start: 'SF',
      comp_playoff_single: 'on',
      comp_playoff_tiebreak: 'PENALES',
      comp_points_win: '3',
      comp_points_draw: '1',
      comp_points_loss: '0',
    }, teamIds);

    // Fixture de grupos: 2 partidos (1 por grupo, una rueda).
    const gen = await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'single' });
    expect(gen.status).toBe(302);
    const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: '12a-grupos-e2e' });
    expect(decodeURIComponent(conf.headers.get('location') ?? '')).toContain('Fixture guardado');
    const fx = await (await admin.get('/admin/fixture?t=12a-grupos-e2e')).text();
    const groupIds = matchIds(fx);
    expect(groupIds.length).toBe(2);

    // Juega la fase de grupos: el local gana 1-0 en ambos.
    for (const mid of groupIds) await jugar(admin, mid, '1', '0', '2026-10-05');

    // Genera las llaves: los 4 clasificados (2 por grupo) → 2 SF + final.
    const llaves = await admin.post('/admin/fixture/llaves', { tournament_id: tid });
    expect(decodeURIComponent(llaves.headers.get('location') ?? '')).toContain('Llaves generadas');

    const fx2 = await (await admin.get('/admin/fixture?t=12a-grupos-e2e')).text();
    const bracketIds = matchIds(fx2).filter((id) => !groupIds.includes(id));
    expect(bracketIds.length).toBe(3); // 2 SF + 1 F

    // La tabla de la fase regular NO cambió con la llave generada.
    const tablaAntes = await (await admin.get('/posiciones?t=12a-grupos-e2e')).text();
    const totalAntes = [...tablaAntes.matchAll(/<strong>(\d+)<\/strong>/g)].reduce((a, m) => a + Number(m[1]), 0);
    expect(totalAntes).toBe(6); // 2 partidos, 3 pts cada ganador

    // Juega las semis: gana el LOCAL de cada una (2-0).
    for (const mid of bracketIds.slice(0, 2)) await jugar(admin, mid, '2', '0', '2026-10-12');

    // El avance automático completó la final con los ganadores de las semis.
    const fx3 = await (await admin.get('/admin/fixture?t=12a-grupos-e2e')).text();
    const finalId = bracketIds[2]!;
    const filaFinal = fx3.split('<tr>').find((chunk) => chunk.includes(`/admin/fixture/${finalId}/eliminar`)) ?? '';
    expect(filaFinal).not.toContain('Por definir');

    // La tabla sigue igual después de jugar las semis (los playoffs no suman).
    const tablaDespues = await (await admin.get('/posiciones?t=12a-grupos-e2e')).text();
    const totalDespues = [...tablaDespues.matchAll(/<strong>(\d+)<\/strong>/g)].reduce((a, m) => a + Number(m[1]), 0);
    expect(totalDespues).toBe(totalAntes);

    // Juega la final: gana el local 3-1.
    await jugar(admin, finalId, '3', '1', '2026-10-19');

    // La tabla sigue intacta después de la final.
    const tablaFinal = await (await admin.get('/posiciones?t=12a-grupos-e2e')).text();
    const totalFinal = [...tablaFinal.matchAll(/<strong>(\d+)<\/strong>/g)].reduce((a, m) => a + Number(m[1]), 0);
    expect(totalFinal).toBe(totalAntes);

    expect((await admin.post(`/admin/torneos/${tid}/eliminar`, {})).status).toBe(302);
  });

  it('recorrido 3 — playoffs ida/vuelta: localía invertida y avance por resultado global', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const teamIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!).slice(0, 4);

    const tid = await crearTorneo(admin, '12A IdaVuelta E2E', '12a-idavuelta-e2e', {
      comp_format: 'GRUPOS_PLAYOFFS',
      comp_groups: '2',
      comp_qualifiers: '2',
      comp_playoff_start: 'SF',
      comp_playoff_tiebreak: 'PENALES',
      comp_points_win: '3',
      comp_points_draw: '1',
      comp_points_loss: '0',
    }, teamIds);

    // Fixture de grupos (1 rueda) + llaves ida/vuelta (2 SF × 2 + final × 2).
    const gen = await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'single' });
    expect(gen.status).toBe(302);
    const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: '12a-idavuelta-e2e' });
    expect(decodeURIComponent(conf.headers.get('location') ?? '')).toContain('Fixture guardado');
    for (const mid of matchIds(await (await admin.get('/admin/fixture?t=12a-idavuelta-e2e')).text())) {
      await jugar(admin, mid, '1', '0', '2026-10-05');
    }
    const llaves = await admin.post('/admin/fixture/llaves', { tournament_id: tid });
    expect(decodeURIComponent(llaves.headers.get('location') ?? '')).toContain('Llaves generadas');

    const fx = await (await admin.get('/admin/fixture?t=12a-idavuelta-e2e')).text();
    const sfLegs = matchIds(fx).filter((id) => {
      const fila = fx.split('<tr>').find((c) => c.includes(`/admin/fixture/${id}/eliminar`)) ?? '';
      return fila.includes('Semifinales');
    });
    expect(sfLegs.length).toBe(4); // 2 cruces × 2 partidos

    // Localía invertida: los dos partidos del mismo cruce tienen el mismo par
    // de equipos, con local/visitante intercambiados.
    const pares = sfLegs.map((id) => {
      const fila = fx.split('<tr>').find((c) => c.includes(`/admin/fixture/${id}/eliminar`)) ?? '';
      return /([^<>\s][^<>]*?) <span class="faint">vs<\/span> ([^<>\s][^<>]*?)</.exec(fila)?.slice(1).join('|') ?? '';
    });
    const ordenado = [...pares].sort();
    const parIda = ordenado[0]!;
    const parRevancha = ordenado.find((p) => p !== parIda && p.split('|').reverse().join('|') === parIda.split('|').reverse().join(''));
    // El par invertido debe existir entre las semis (ida y revancha).
    expect(pares.some((p) => p !== parIda && p.split('|')[0] === parIda.split('|')[1] && p.split('|')[1] === parIda.split('|')[0])).toBe(true);
    void parRevancha;

    // Juega la ida de un cruce: el visitante gana 0-2. En la revancha,
    // ese equipo es local: si gana 2-0, el global es 4-0 y avanza aunque
    // haya "perdido" de local — el avance sale del global, no del partido.
    // Juega las 4 semis: ida 0-2 (visitante), revancha 1-1.
    // Cruz A: ida 0-2, vuelta 1-1 → global 3-2 para el visitante de la ida.
    // Cruz B: ida 2-0, vuelta 0-0 → global 2-0 para el local de la ida.
    for (const [i, mid] of sfLegs.entries()) {
      if (i < 2) await jugar(admin, mid, i === 0 ? '0' : '2', i === 0 ? '2' : '0', '2026-10-12');
      else await jugar(admin, mid, '1', '1', '2026-10-19');
    }

    // Ambas finales de ida/vuelta quedan completadas por el avance automático.
    const fx2 = await (await admin.get('/admin/fixture?t=12a-idavuelta-e2e')).text();
    const finalLegs = matchIds(fx2).filter((id) => !sfLegs.includes(id) && !sfLegs.includes(id));
    const filasFinal = finalLegs.map((id) => fx2.split('<tr>').find((c) => c.includes(`/admin/fixture/${id}/eliminar`)) ?? '');
    for (const fila of filasFinal) expect(fila).not.toContain('Por definir');

    expect((await admin.post(`/admin/torneos/${tid}/eliminar`, {})).status).toBe(302);
  });

  it('recorrido 4 — tercer puesto: los perdedores de las semis avanzan al 3P', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const teamIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!).slice(0, 4);

    const tid = await crearTorneo(admin, '12A Tercero E2E', '12a-tercero-e2e', {
      comp_format: 'GRUPOS_PLAYOFFS',
      comp_groups: '2',
      comp_qualifiers: '2',
      comp_playoff_start: 'SF',
      comp_playoff_single: 'on',
      comp_playoff_third: 'on',
      comp_playoff_tiebreak: 'PENALES',
      comp_points_win: '3',
      comp_points_draw: '1',
      comp_points_loss: '0',
    }, teamIds);

    // Grupos + llaves con 3er puesto: 2 SF + 3P + final = 4 partidos.
    const gen = await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'single' });
    expect(gen.status).toBe(302);
    const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: '12a-tercero-e2e' });
    expect(decodeURIComponent(conf.headers.get('location') ?? '')).toContain('Fixture guardado');
    for (const mid of matchIds(await (await admin.get('/admin/fixture?t=12a-tercero-e2e')).text())) {
      await jugar(admin, mid, '1', '0', '2026-10-05');
    }
    const llaves = await admin.post('/admin/fixture/llaves', { tournament_id: tid });
    expect(decodeURIComponent(llaves.headers.get('location') ?? '')).toContain('Llaves generadas');

    const fx = await (await admin.get('/admin/fixture?t=12a-tercero-e2e')).text();
    const bracketIds = matchIds(fx).filter((id) => {
      const fila = fx.split('<tr>').find((c) => c.includes(`/admin/fixture/${id}/eliminar`)) ?? '';
      return fila.includes('Semifinales') || fila.includes('Tercer puesto') || fila.includes('Final');
    });
    expect(bracketIds.length).toBe(4); // 2 SF + 3P + F

    // Juega las 2 semis (local gana 2-0).
    const sfIds = bracketIds.filter((id) => {
      const fila = fx.split('<tr>').find((c) => c.includes(`/admin/fixture/${id}/eliminar`)) ?? '';
      return fila.includes('Semifinales');
    });
    expect(sfIds.length).toBe(2);
    for (const mid of sfIds) await jugar(admin, mid, '2', '0', '2026-10-12');

    // El avance automático completó el 3P con los PERDEDORES y la final con
    // los ganadores.
    const fx2 = await (await admin.get('/admin/fixture?t=12a-tercero-e2e')).text();
    const tercerId = bracketIds.find((id) => {
      const fila = fx2.split('<tr>').find((c) => c.includes(`/admin/fixture/${id}/eliminar`)) ?? '';
      return fila.includes('Tercer puesto');
    })!;
    const filaTercer = fx2.split('<tr>').find((chunk) => chunk.includes(`/admin/fixture/${tercerId}/eliminar`)) ?? '';
    expect(filaTercer).not.toContain('Por definir');
    const finalId = bracketIds.find((id) => {
      const fila = fx2.split('<tr>').find((c) => c.includes(`/admin/fixture/${id}/eliminar`)) ?? '';
      return fila.includes('Final') && !fila.includes('Tercer puesto');
    })!;
    const filaFinal = fx2.split('<tr>').find((chunk) => chunk.includes(`/admin/fixture/${finalId}/eliminar`)) ?? '';
    expect(filaFinal).not.toContain('Por definir');

    // Juega el 3P y la final: la tabla de la fase regular no cambia.
    const tablaAntes = await (await admin.get('/posiciones?t=12a-tercero-e2e')).text();
    const totalAntes = [...tablaAntes.matchAll(/<strong>(\d+)<\/strong>/g)].reduce((a, m) => a + Number(m[1]), 0);
    await jugar(admin, tercerId, '1', '0', '2026-10-19');
    await jugar(admin, finalId, '2', '1', '2026-10-19');
    const tablaDespues = await (await admin.get('/posiciones?t=12a-tercero-e2e')).text();
    const totalDespues = [...tablaDespues.matchAll(/<strong>(\d+)<\/strong>/g)].reduce((a, m) => a + Number(m[1]), 0);
    expect(totalDespues).toBe(totalAntes);

    expect((await admin.post(`/admin/torneos/${tid}/eliminar`, {})).status).toBe(302);
  });
});

describe.skipIf(!has)('e2e: cierre del motor de playoffs (Fase 12B)', () => {
  /** Guarda un resultado jugado (goles "sin autor" y penales opcionales como puntos manuales). */
  async function jugar(admin: ReturnType<typeof client>, mid: string, homeGoals: string, awayGoals: string, day: string, homePen = '', awayPen = ''): Promise<void> {
    const raws: Record<string, string> = {
      status: 'played',
      played_on: day,
      kickoff_time: '10:00',
      venue: 'Cancha Norte',
      home_goals: homeGoals,
      away_goals: awayGoals,
      notes: '',
    };
    if (homePen) raws['home_points'] = homePen;
    if (awayPen) raws['away_points'] = awayPen;
    for (let i = 1; i <= Number(homeGoals); i++) raws[`hg${i}`] = 'none';
    for (let i = 1; i <= Number(awayGoals); i++) raws[`ag${i}`] = 'none';
    const res = await admin.post(`/admin/planilla/${mid}`, raws);
    expect(res.status).toBe(302);
    const loc = decodeURIComponent(res.headers.get('location') ?? '');
    expect(loc, `planilla ${mid}: ${loc}`).toContain('Planilla guardada');
  }

  /** IDs únicos de partidos en el HTML del fixture. */
  function matchIds(html: string): string[] {
    return [...new Set([...html.matchAll(/\/admin\/fixture\/(\d+)\/eliminar/g)].map((m) => m[1]!))];
  }

  /** Fila HTML de un partido del fixture (o ''). */
  function filaDe(html: string, id: string): string {
    return html.split('<tr>').find((c) => c.includes(`/admin/fixture/${id}/eliminar`)) ?? '';
  }

  /** Nombres (texto) de los dos equipos de una fila de fixture. */
  function equiposDe(fila: string): string[] {
    const m = /<td>([^<]+) <span class="faint">vs<\/span> ([^<]+)</.exec(fila);
    return m ? [m[1]!.trim(), m[2]!.trim()] : [];
  }

  /** Alta de torneo + participantes. Devuelve el id del torneo. */
  async function crearTorneo(
    admin: ReturnType<typeof client>,
    nombre: string,
    extra: Record<string, string>,
    teamIds: string[]
  ): Promise<string> {
    const alta = await admin.post('/admin/torneos', {
      name: nombre,
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      ...extra,
    });
    expect(alta.status).toBe(302);
    const listado = await (await admin.get('/admin/torneos')).text();
    const tid = listado
      .split('<article')
      .filter((chunk) => chunk.includes(nombre))
      .map((chunk) => /href="\/admin\/torneos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '')
      .find(Boolean) ?? '';
    expect(tid).toBeTruthy();
    const partBody: Record<string, string> = {
      name: nombre,
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      ...extra,
    };
    for (const id of teamIds) partBody[`participate_${id}`] = 'on';
    const part = await admin.post(`/admin/torneos/${tid}`, partBody);
    expect(part.status).toBe(302);
    return tid;
  }

  it('varias rondas: QF → SF → F con propagación de ganadores verificada por nombre', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);
    const teamsHtml0 = await (await admin.get('/admin/equipos')).text();
    let teamIds = [...teamsHtml0.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!);
    // Cuartos necesita 8 equipos: crea los que falten (el entorno base tiene 4
    // y otros tests agregan algunos; este test garantiza los suyos).
    for (const nombreExtra of ['Zonda 12B', 'Yerbal 12B']) {
      if (teamIds.length < 8) {
        await admin.post('/admin/equipos', { name: nombreExtra, short_name: nombreExtra.slice(0, 3).toUpperCase(), color: '#8b5cf6', active: 'on' });
        const html = await (await admin.get('/admin/equipos')).text();
        teamIds = [...html.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!);
      }
    }
    expect(teamIds.length).toBeGreaterThanOrEqual(8);
    const ocho = teamIds.slice(0, 8);

    const tid = await crearTorneo(admin, '12B Cuartos E2E', {
      comp_format: 'ELIMINACION_DIRECTA',
      comp_playoff_start: 'QF',
      comp_playoff_single: 'on',
      comp_playoff_tiebreak: 'PENALES',
    }, ocho);

    // La copa genera llaves directo: 4 QF + 2 SF + 1 F = 7 partidos.
    const llaves = await admin.post('/admin/fixture/llaves', { tournament_id: tid });
    expect(decodeURIComponent(llaves.headers.get('location') ?? '')).toContain('Llaves generadas');

    const fx = await (await admin.get('/admin/fixture?t=12b-cuartos-e2e')).text();
    const qf = matchIds(fx).filter((id) => filaDe(fx, id).includes('Cuartos'));
    const sf = matchIds(fx).filter((id) => filaDe(fx, id).includes('Semifinales'));
    const fin = matchIds(fx).filter((id) => filaDe(fx, id).includes('Final') && !filaDe(fx, id).includes('Tercer'));
    expect(qf.length).toBe(4);
    expect(sf.length).toBe(2);
    expect(fin.length).toBe(1);

    // Antes de jugar, las rondas siguientes esperan sus ganadores (→ WQF1…).
    for (const id of [...sf, ...fin]) expect(filaDe(fx, id)).toContain('→ W');

    // QF1 y QF2: gana el local. QF3 y QF4: gana el visitante.
    await jugar(admin, qf[0]!, '2', '0', '2026-10-05');
    await jugar(admin, qf[1]!, '2', '0', '2026-10-05');
    await jugar(admin, qf[2]!, '0', '1', '2026-10-05');
    await jugar(admin, qf[3]!, '0', '2', '2026-10-05');

    // La semifinal 1 (alimentada por QF1/QF2) ya tiene equipos; la 2 también.
    const fx2 = await (await admin.get('/admin/fixture?t=12b-cuartos-e2e')).text();
    for (const id of sf) expect(filaDe(fx2, id)).not.toContain('→ W');
    expect(filaDe(fx2, fin[0]!)).toContain('→ W'); // la final espera

    // La final recibe exactamente a los ganadores: SF1 = ganador QF1 vs ganador QF2.
    const ganadorQf1 = equiposDe(filaDe(fx, qf[0]!))[Number('0') === 0 ? 0 : 0]; // local de QF1
    const ganadorQf2 = equiposDe(filaDe(fx, qf[1]!))[0]; // local de QF2
    const ganadorQf3 = equiposDe(filaDe(fx, qf[2]!))[1]; // visitante de QF3
    const ganadorQf4 = equiposDe(filaDe(fx, qf[3]!))[1]; // visitante de QF4
    const [sf1Eq, sf2Eq] = sf.map((id) => equiposDe(filaDe(fx2, id)));
    expect(sf1Eq).toEqual(expect.arrayContaining([ganadorQf1]));
    expect(sf1Eq).toEqual(expect.arrayContaining([ganadorQf2]));
    expect(sf2Eq).toEqual(expect.arrayContaining([ganadorQf3]));
    expect(sf2Eq).toEqual(expect.arrayContaining([ganadorQf4]));

    // Juega las semis: gana el local de cada una → la final queda completa.
    await jugar(admin, sf[0]!, '3', '1', '2026-10-12');
    await jugar(admin, sf[1]!, '1', '0', '2026-10-12');
    const fx3 = await (await admin.get('/admin/fixture?t=12b-cuartos-e2e')).text();
    expect(filaDe(fx3, fin[0]!)).not.toContain('→ W');
    const finalEq = equiposDe(filaDe(fx3, fin[0]!));
    expect(finalEq).toEqual(expect.arrayContaining([equiposDe(filaDe(fx3, sf[0]!))[0]])); // ganador SF1 (local)
    expect(finalEq).toEqual(expect.arrayContaining([equiposDe(filaDe(fx3, sf[1]!))[0]])); // ganador SF2 (local)

    // Identidades reales: los dos lados de la final son equipos existentes.
    for (const n of finalEq) expect(n).toBeTruthy();

    expect((await admin.post(`/admin/torneos/${tid}/eliminar`, {})).status).toBe(302);
  });

  it('ida/vuelta con empate global: la revancha con penales decide el avance', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const teamIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!).slice(0, 4);

    const tid = await crearTorneo(admin, '12B Penales E2E', {
      comp_format: 'GRUPOS_PLAYOFFS',
      comp_groups: '2',
      comp_qualifiers: '2',
      comp_playoff_start: 'SF',
      comp_playoff_tiebreak: 'PENALES',
      comp_points_win: '3',
      comp_points_draw: '1',
      comp_points_loss: '0',
    }, teamIds);

    // Grupos jugados + llaves ida/vuelta (2 SF × 2 + final × 2 = 6 partidos).
    const gen = await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'single' });
    expect(gen.status).toBe(302);
    const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: '12b-penales-e2e' });
    expect(decodeURIComponent(conf.headers.get('location') ?? '')).toContain('Fixture guardado');
    for (const mid of matchIds(await (await admin.get('/admin/fixture?t=12b-penales-e2e')).text())) {
      await jugar(admin, mid, '1', '0', '2026-10-05');
    }
    const llaves = await admin.post('/admin/fixture/llaves', { tournament_id: tid });
    expect(decodeURIComponent(llaves.headers.get('location') ?? '')).toContain('Llaves generadas');

    const fx = await (await admin.get('/admin/fixture?t=12b-penales-e2e')).text();
    const sfLegs = matchIds(fx).filter((id) => filaDe(fx, id).includes('Semifinales'));
    expect(sfLegs.length).toBe(4);

    // Cruz A (SF1): ida 1-1, vuelta 1-1 → global 2-2. La vuelta con penales
    // 5-4 para el visitante de la vuelta → avanza el visitante de la vuelta.
    // Cruz B (SF2): ida 2-0 local, vuelta 0-1 → global 2-1, avanza el local ida.
    const [idaA, idaB] = sfLegs.slice(0, 2);
    const [vueltaA, vueltaB] = sfLegs.slice(2);
    await jugar(admin, idaA!, '1', '1', '2026-10-12');
    await jugar(admin, vueltaA!, '1', '1', '2026-10-19', '4', '5'); // penales: visitante
    await jugar(admin, idaB!, '2', '0', '2026-10-12');
    await jugar(admin, vueltaB!, '0', '1', '2026-10-19');

    // Ambas idas de la final quedan completadas por el avance automático.
    const fx2 = await (await admin.get('/admin/fixture?t=12b-penales-e2e')).text();
    const finalLegs = matchIds(fx2).filter((id) => filaDe(fx2, id).includes('Final') && !filaDe(fx2, id).includes('Tercer'));
    expect(finalLegs.length).toBe(2);
    for (const id of finalLegs) expect(filaDe(fx2, id)).not.toContain('Por definir');

    // Identidad: el finalista A es el visitante de la vuelta del cruz A
    // (quien ganó los penales), NO el local.
    const finalistaA = equiposDe(filaDe(fx2, finalLegs[0]!));
    const visitaVueltaA = equiposDe(filaDe(fx, vueltaA!))[1];
    expect(finalistaA).toContain(visitaVueltaA);

    // Juega la final ida/vuelta: la tabla de la fase regular no cambia.
    const tablaAntes = await (await admin.get('/posiciones?t=12b-penales-e2e')).text();
    const totalAntes = [...tablaAntes.matchAll(/<strong>(\d+)<\/strong>/g)].reduce((a, m) => a + Number(m[1]), 0);
    await jugar(admin, finalLegs[0]!, '2', '1', '2026-10-26');
    await jugar(admin, finalLegs[1]!, '0', '1', '2026-11-02');
    const tablaDespues = await (await admin.get('/posiciones?t=12b-penales-e2e')).text();
    const totalDespues = [...tablaDespues.matchAll(/<strong>(\d+)<\/strong>/g)].reduce((a, m) => a + Number(m[1]), 0);
    expect(totalDespues).toBe(totalAntes);

    expect((await admin.post(`/admin/torneos/${tid}/eliminar`, {})).status).toBe(302);
  });

  it('tercer puesto: los perdedores reales de las semis van al 3P (identidades verificadas)', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const teamIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!).slice(0, 4);

    const tid = await crearTorneo(admin, '12B Tercero E2E', {
      comp_format: 'GRUPOS_PLAYOFFS',
      comp_groups: '2',
      comp_qualifiers: '2',
      comp_playoff_start: 'SF',
      comp_playoff_single: 'on',
      comp_playoff_third: 'on',
      comp_playoff_tiebreak: 'PENALES',
      comp_points_win: '3',
      comp_points_draw: '1',
      comp_points_loss: '0',
    }, teamIds);

    // Grupos + llaves: 2 SF + 3P + F = 4 partidos de llave.
    const gen = await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'single' });
    expect(gen.status).toBe(302);
    const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: '12b-tercero-e2e' });
    expect(decodeURIComponent(conf.headers.get('location') ?? '')).toContain('Fixture guardado');
    for (const mid of matchIds(await (await admin.get('/admin/fixture?t=12b-tercero-e2e')).text())) {
      await jugar(admin, mid, '1', '0', '2026-10-05');
    }
    const llaves = await admin.post('/admin/fixture/llaves', { tournament_id: tid });
    expect(decodeURIComponent(llaves.headers.get('location') ?? '')).toContain('Llaves generadas');

    const fx = await (await admin.get('/admin/fixture?t=12b-tercero-e2e')).text();
    const sf = matchIds(fx).filter((id) => filaDe(fx, id).includes('Semifinales'));
    const tercer = matchIds(fx).filter((id) => filaDe(fx, id).includes('Tercer puesto'));
    const fin = matchIds(fx).filter((id) => filaDe(fx, id).includes('Final') && !filaDe(fx, id).includes('Tercer'));
    expect(sf.length).toBe(2);
    expect(tercer.length).toBe(1);
    expect(fin.length).toBe(1);

    // SF1: gana el local. SF2: gana el visitante.
    const perdedorSf1 = equiposDe(filaDe(fx, sf[0]!))[1];
    const ganadorSf1 = equiposDe(filaDe(fx, sf[0]!))[0];
    const perdedorSf2 = equiposDe(filaDe(fx, sf[1]!))[0];
    const ganadorSf2 = equiposDe(filaDe(fx, sf[1]!))[1];
    await jugar(admin, sf[0]!, '2', '0', '2026-10-12');
    await jugar(admin, sf[1]!, '0', '3', '2026-10-12');

    // 3P = perdedor SF1 vs perdedor SF2 (identidades exactas).
    const fx2 = await (await admin.get('/admin/fixture?t=12b-tercero-e2e')).text();
    const tercerEq = equiposDe(filaDe(fx2, tercer[0]!));
    expect(tercerEq).toEqual(expect.arrayContaining([perdedorSf1]));
    expect(tercerEq).toEqual(expect.arrayContaining([perdedorSf2]));
    expect(tercerEq).not.toContain(ganadorSf1);
    expect(tercerEq).not.toContain(ganadorSf2);
    // Final = ganadores.
    const finalEq = equiposDe(filaDe(fx2, fin[0]!));
    expect(finalEq).toEqual(expect.arrayContaining([ganadorSf1]));
    expect(finalEq).toEqual(expect.arrayContaining([ganadorSf2]));

    expect((await admin.post(`/admin/torneos/${tid}/eliminar`, {})).status).toBe(302);
  });
});

describe.skipIf(!has)('e2e: estados y cierre de competencia (Fase 12C)', () => {
  /** IDs únicos de partidos en el HTML del fixture. */
  function ids12c(html: string): string[] {
    return [...new Set([...html.matchAll(/\/admin\/fixture\/(\d+)\/eliminar/g)].map((m) => m[1]!))];
  }

  it('ciclo completo: BORRADOR → INSCRIPCIONES → ACTIVO → FINALIZADO → ARCHIVADO con bloqueos por etapa', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const teamIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!).slice(0, 4);

    // BORRADOR: alta con 4 participantes y formato UNA_RUEDA.
    const alta = await admin.post('/admin/torneos', {
      name: '12C Ciclo E2E',
      season: '2026',
      status: 'draft',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'UNA_RUEDA',
      comp_points_win: '3',
      comp_points_draw: '1',
      comp_points_loss: '0',
    });
    expect(alta.status).toBe(302);
    const listado = await (await admin.get('/admin/torneos')).text();
    const tid = listado
      .split('<article')
      .filter((chunk) => chunk.includes('12C Ciclo E2E'))
      .map((chunk) => /href="\/admin\/torneos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '')
      .find(Boolean) ?? '';
    expect(tid).toBeTruthy();
    const partBody: Record<string, string> = {
      name: '12C Ciclo E2E',
      season: '2026',
      status: 'draft',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'UNA_RUEDA',
    };
    for (const id of teamIds) partBody[`participate_${id}`] = 'on';
    expect((await admin.post(`/admin/torneos/${tid}`, partBody)).status).toBe(302);

    // BORRADOR: fixture se genera sin problema.
    expect((await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'single' })).status).toBe(302);
    const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: '12c-ciclo-e2e' });
    expect(decodeURIComponent(conf.headers.get('location') ?? '')).toContain('Fixture guardado');
    const fx = await (await admin.get('/admin/fixture?t=12c-ciclo-e2e')).text();
    const ids = ids12c(fx);
    expect(ids.length).toBe(6);

    // BORRADOR → INSCRIPCIONES.
    const aIns = await admin.post(`/admin/torneos/${tid}`, {
      ...partBody,
      status: 'registrations',
    });
    expect(aIns.status).toBe(302);

    // INSCRIPCIONES: puede jugar partidos igual (resultado de prueba) y el
    // fixture no se rompe.
    expect((await admin.post(`/admin/planilla/${ids[0]}`, {
      status: 'played',
      played_on: '2026-10-05',
      kickoff_time: '10:00',
      venue: 'Cancha Norte',
      home_goals: '1',
      away_goals: '0',
      hg1: 'none',
      notes: '',
    })).status).toBe(302);

    // INSCRIPCIONES → ACTIVO.
    expect((await admin.post(`/admin/torneos/${tid}`, { ...partBody, status: 'active' })).status).toBe(302);

    // ACTIVO: la estructura queda congelada — regenerar el cruce rechaza
    // pisar el fixture existente (guardia de jugados) y la estructura
    // competitiva ya no se puede cambiar desde el form del torneo.
    const estructura = await admin.post(`/admin/torneos/${tid}`, {
      ...partBody,
      status: 'active',
      comp_format: 'DOS_RUEDAS', // intento de cambio estructural
    });
    expect(estructura.status).toBe(400);
    const estructuraHtml = await estructura.text();
    expect(estructuraHtml).toContain('en curso');

    // ACTIVO: seguir cargando resultados sigue funcionando.
    expect((await admin.post(`/admin/planilla/${ids[1]}`, {
      status: 'played',
      played_on: '2026-10-05',
      kickoff_time: '10:00',
      venue: 'Cancha Norte',
      home_goals: '2',
      away_goals: '0',
      hg1: 'none',
      hg2: 'none',
      notes: '',
    })).status).toBe(302);

    // ACTIVO: la participación queda fijada (el guardado no da de baja).
    const sinBaja: Record<string, string> = { ...partBody, status: 'active' };
    // (no manda ningún participate_ → si el servidor aceptara la baja, quedaría vacío)
    await admin.post(`/admin/torneos/${tid}`, sinBaja);
    const equiposTras = await (await admin.get(`/admin/torneos/${tid}`)).text();
    for (const id of teamIds) {
      expect(equiposTras).toContain(`name="participate_${id}"`);
    }

    // ACTIVO → FINALIZADO.
    expect((await admin.post(`/admin/torneos/${tid}`, { ...partBody, status: 'finished' })).status).toBe(302);

    // FINALIZADO: solo lectura.
    const confFin = await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: '12c-ciclo-e2e' });
    const confFinLoc = decodeURIComponent(confFin.headers.get('location') ?? '');
    expect(confFinLoc).toContain('err=');
    expect(confFinLoc).toContain('finalizado');
    // No se pueden modificar resultados históricos.
    const resFin = await admin.post(`/admin/planilla/${ids[1]}`, {
      status: 'played',
      played_on: '2026-10-05',
      kickoff_time: '10:00',
      venue: 'Cancha Norte',
      home_goals: '9',
      away_goals: '9',
      notes: '',
    });
    expect(resFin.status).toBe(302);
    expect(decodeURIComponent(resFin.headers.get('location') ?? '')).toContain('finalizado');
    // La transición a active está bloqueada (no se reabre): 400 con el motivo.
    const reabrir = await admin.post(`/admin/torneos/${tid}`, { ...partBody, status: 'active' });
    expect(reabrir.status).toBe(400);
    expect(await reabrir.text()).toContain('no vuelve');

    // Los resultados siguen intactos después de los intentos.
    const tabla = await (await admin.get('/posiciones?t=12c-ciclo-e2e')).text();
    const pts = [...tabla.matchAll(/<strong>(\d+)<\/strong>/g)].map((m) => Number(m[1]));
    expect(pts.reduce((a, b) => a + b, 0)).toBe(6); // 1-0 (3 pts) + 2-0 (3 pts)

    // FINALIZADO → ARCHIVADO.
    expect((await admin.post(`/admin/torneos/${tid}`, { ...partBody, status: 'archived' })).status).toBe(302);

    // ARCHIVADO: solo lectura total, y no se reabre.
    const resArch = await admin.post(`/admin/planilla/${ids[1]}`, {
      status: 'played',
      played_on: '2026-10-05',
      kickoff_time: '10:00',
      venue: 'Cancha Norte',
      home_goals: '8',
      away_goals: '8',
      notes: '',
    });
    expect(decodeURIComponent(resArch.headers.get('location') ?? '')).toContain('archivado');
    const reabrirArch = await admin.post(`/admin/torneos/${tid}`, { ...partBody, status: 'active' });
    expect(reabrirArch.status).toBe(400);

    // Limpieza.
    expect((await admin.post(`/admin/torneos/${tid}/eliminar`, {})).status).toBe(302);
  });

  it('ACTIVO: bloqueos de estructura, partido suelto y participants fijados, resultados permitidos', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const teamIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!).slice(0, 4);

    // Crear en activo directo (alta → activo es una transición válida).
    const alta = await admin.post('/admin/torneos', {
      name: '12C Activo E2E',
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'UNA_RUEDA',
      comp_points_win: '3',
      comp_points_draw: '1',
      comp_points_loss: '0',
    });
    expect(alta.status).toBe(302);
    const listado = await (await admin.get('/admin/torneos')).text();
    const tid = listado
      .split('<article')
      .filter((chunk) => chunk.includes('12C Activo E2E'))
      .map((chunk) => /href="\/admin\/torneos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '')
      .find(Boolean) ?? '';
    expect(tid).toBeTruthy();
    const partBody: Record<string, string> = {
      name: '12C Activo E2E',
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'UNA_RUEDA',
    };
    for (const id of teamIds) partBody[`participate_${id}`] = 'on';
    expect((await admin.post(`/admin/torneos/${tid}`, partBody)).status).toBe(302);

    // En ACTIVO el fixture se genera una vez (aún no existe)...
    expect((await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'single' })).status).toBe(302);
    const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: '12c-activo-e2e' });
    expect(decodeURIComponent(conf.headers.get('location') ?? '')).toContain('Fixture guardado');
    const fx = await (await admin.get('/admin/fixture?t=12c-activo-e2e')).text();
    const ids = ids12c(fx);
    expect(ids.length).toBe(6);

    // ...pero la estructura competitiva ya no se puede cambiar desde el form.
    const estructura = await admin.post(`/admin/torneos/${tid}`, {
      ...partBody,
      status: 'active',
      comp_format: 'DOS_RUEDAS',
    });
    expect(estructura.status).toBe(400);
    expect(await estructura.text()).toContain('en curso');

    // Resultados: permitidos en activo.
    expect((await admin.post(`/admin/planilla/${ids[0]}`, {
      status: 'played',
      played_on: '2026-10-05',
      kickoff_time: '10:00',
      venue: 'Cancha Norte',
      home_goals: '3',
      away_goals: '0',
      hg1: 'none',
      hg2: 'none',
      hg3: 'none',
      notes: '',
    })).status).toBe(302);

    // Limpieza.
    expect((await admin.post(`/admin/torneos/${tid}/eliminar`, {})).status).toBe(302);
  });
});

describe.skipIf(!has)('e2e: reprogramación de partidos (Fase 13)', () => {
  /** IDs únicos de partidos en el HTML del fixture. */
  function ids13(html: string): string[] {
    return [...new Set([...html.matchAll(/\/admin\/fixture\/(\d+)\/eliminar/g)].map((m) => m[1]!))];
  }

  async function altaTorneo13(
    admin: ReturnType<typeof client>,
    nombre: string,
    status: string,
    teamIds: string[],
    extra: Record<string, string> = {}
  ): Promise<{ tid: string; partBody: Record<string, string> }> {
    const alta = await admin.post('/admin/torneos', {
      name: nombre,
      season: '2026',
      status,
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'UNA_RUEDA',
      comp_points_win: '3',
      comp_points_draw: '1',
      comp_points_loss: '0',
      ...extra,
    });
    expect(alta.status).toBe(302);
    const listado = await (await admin.get('/admin/torneos')).text();
    const tid = listado
      .split('<article')
      .filter((chunk) => chunk.includes(nombre))
      .map((chunk) => /href="\/admin\/torneos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '')
      .find(Boolean) ?? '';
    expect(tid).toBeTruthy();
    const partBody: Record<string, string> = {
      name: nombre,
      season: '2026',
      status,
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'UNA_RUEDA',
    };
    for (const id of teamIds) partBody[`participate_${id}`] = 'on';
    expect((await admin.post(`/admin/torneos/${tid}`, partBody)).status).toBe(302);
    return { tid, partBody };
  }

  it('reprogramar un partido: cambia día/hora/cancha, registra motivo y no toca resultado ni eventos', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const teamIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!).slice(0, 4);

    const { tid, partBody } = await altaTorneo13(admin, '13 Reprog E2E', 'active', teamIds);
    expect((await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'single' })).status).toBe(302);
    const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: '13-reprog-e2e' });
    expect(decodeURIComponent(conf.headers.get('location') ?? '')).toContain('Fixture guardado');
    const fx = await (await admin.get('/admin/fixture?t=13-reprog-e2e')).text();
    const ids = ids13(fx);
    expect(ids.length).toBe(6);

    // Se juega el partido 1 (2-0 con autor sin nombre) y el partido 2 queda
    // pendiente para reprogramar.
    const jugadoId = ids[0]!;
    const pendienteId = ids[1]!;
    expect((await admin.post(`/admin/planilla/${jugadoId}`, {
      status: 'played',
      played_on: '2026-10-05',
      kickoff_time: '10:00',
      venue: 'Cancha Norte',
      home_goals: '2',
      away_goals: '0',
      hg1: 'none',
      hg2: 'none',
      notes: '',
    })).status).toBe(302);

    // Reprograma el pendiente: nueva fecha, hora y cancha, con motivo.
    const res = await admin.post(`/admin/fixture/${pendienteId}/reprogramar`, {
      played_on: '2026-10-28',
      kickoff_time: '18:30',
      venue: 'Cancha Sur',
      reason: 'La cancha original está inundada',
    });
    expect(res.status).toBe(302);
    const loc = decodeURIComponent(res.headers.get('location') ?? '');
    expect(loc).toContain('reprogramado');
    expect(loc).toContain('motivo quedó registrado');

    // El fixture muestra la nueva fecha (28 oct) y no la vieja (10 oct) en
    // la fila del partido.
    const fx2 = await (await admin.get('/admin/fixture?t=13-reprog-e2e')).text();
    const fila = fx2.split('<tr>').find((c) => c.includes(`/admin/fixture/${pendienteId}/eliminar`)) ?? '';
    expect(fila).toContain('28');
    expect(fila).toContain('18:30');
    expect(fila).toContain('Cancha Sur');

    // La planilla muestra el formulario y el historial con el motivo.
    const sheet = await (await admin.get(`/admin/planilla/${pendienteId}`)).text();
    expect(sheet).toContain('Reprogramar partido');
    expect(sheet).toContain('Historial de reprogramaciones');
    expect(sheet).toContain('La cancha original está inundada');
    expect(sheet).toContain('Cancha Norte'); // el "antes"

    // El partido jugado muestra el bloque de "ya se jugó", no el formulario.
    const sheetJugado = await (await admin.get(`/admin/planilla/${jugadoId}`)).text();
    expect(sheetJugado).toContain('ya se jugó');
    expect(sheetJugado).not.toContain('Reprogramar partido</h2>');

    // El resultado y el historial quedan intactos (tabla: solo 3 pts del jugado).
    const tabla = await (await admin.get('/posiciones?t=13-reprog-e2e')).text();
    const pts = [...tabla.matchAll(/<strong>(\d+)<\/strong>/g)].map((m) => Number(m[1]));
    expect(pts.reduce((a, b) => a + b, 0)).toBe(3);

    // Sin motivo: rechaza.
    const sinMotivo = await admin.post(`/admin/fixture/${pendienteId}/reprogramar`, {
      played_on: '2026-10-29',
      kickoff_time: '',
      venue: '',
      reason: '',
    });
    expect(decodeURIComponent(sinMotivo.headers.get('location') ?? '')).toContain('motivo');

    // Limpieza.
    expect((await admin.post(`/admin/torneos/${tid}/eliminar`, {})).status).toBe(302);
    void partBody;
  });

  it('bloqueos: partido jugado, torneo finalizado y archivado no se reprograman', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const teamIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!).slice(0, 4);

    const { tid, partBody } = await altaTorneo13(admin, '13 Reprog Bloqueos E2E', 'active', teamIds);
    expect((await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'single' })).status).toBe(302);
    const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: '13-reprog-bloq-e2e' });
    expect(decodeURIComponent(conf.headers.get('location') ?? '')).toContain('Fixture guardado');
    const ids = ids13(await (await admin.get('/admin/fixture?t=13-reprog-bloq-e2e')).text());

    // Se juega el partido 1.
    expect((await admin.post(`/admin/planilla/${ids[0]}`, {
      status: 'played',
      played_on: '2026-10-05',
      kickoff_time: '10:00',
      venue: 'Cancha Norte',
      home_goals: '1',
      away_goals: '0',
      hg1: 'none',
      notes: '',
    })).status).toBe(302);

    // Intento de reprogramar el JUGADO: rechaza (aunque el torneo siga activo).
    const jugado = await admin.post(`/admin/fixture/${ids[0]}/reprogramar`, {
      played_on: '2026-10-30',
      kickoff_time: '',
      venue: '',
      reason: 'intento sobre un jugado',
    });
    expect(decodeURIComponent(jugado.headers.get('location') ?? '')).toContain('ya se jugó');

    // El resultado del jugado quedó intacto (1-0 → 3 pts) tras el intento.
    const tabla = await (await admin.get('/posiciones?t=13-reprog-bloqueos-e2e')).text();
    const pts = [...tabla.matchAll(/<strong>(\d+)<\/strong>/g)].map((m) => Number(m[1]));
    expect(pts.reduce((a, b) => a + b, 0)).toBe(3);

    // Torneo → FINALIZADO: reprogramar el pendiente queda bloqueado.
    expect((await admin.post(`/admin/torneos/${tid}`, { ...partBody, status: 'finished' })).status).toBe(302);
    const fin = await admin.post(`/admin/fixture/${ids[1]}/reprogramar`, {
      played_on: '2026-10-30',
      kickoff_time: '',
      venue: '',
      reason: 'intento en torneo finalizado',
    });
    expect(decodeURIComponent(fin.headers.get('location') ?? '')).toContain('finalizado');

    // Torneo → ARCHIVADO: mensaje de archivado.
    expect((await admin.post(`/admin/torneos/${tid}`, { ...partBody, status: 'archived' })).status).toBe(302);
    const arch = await admin.post(`/admin/fixture/${ids[1]}/reprogramar`, {
      played_on: '2026-10-31',
      kickoff_time: '',
      venue: '',
      reason: 'intento en torneo archivado',
    });
    expect(decodeURIComponent(arch.headers.get('location') ?? '')).toContain('archivado');

    // La fecha del pendiente sigue siendo la original.
    const fx = await (await admin.get('/admin/fixture?t=13-reprog-bloq-e2e')).text();
    const fila = fx.split('<tr>').find((c) => c.includes(`/admin/fixture/${ids[1]}/eliminar`)) ?? '';
    expect(fila).not.toContain('Cancha Sur');

    // Limpieza.
    expect((await admin.post(`/admin/torneos/${tid}/eliminar`, {})).status).toBe(302);
  });

  it('playoff pendiente: reprogramar la semifinal no cambia la llave ni sus orígenes', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const teamIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!).slice(0, 4);

    // Grupos + Playoffs con SF en partido único.
    const alta = await admin.post('/admin/torneos', {
      name: '13 Reprog Playoff E2E',
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'GRUPOS_PLAYOFFS',
      comp_groups: '2',
      comp_qualifiers: '2',
      comp_playoff_start: 'SF',
      comp_playoff_single: 'on',
      comp_playoff_tiebreak: 'PENALES',
      comp_points_win: '3',
      comp_points_draw: '1',
      comp_points_loss: '0',
    });
    expect(alta.status).toBe(302);
    const listado = await (await admin.get('/admin/torneos')).text();
    const tid = listado
      .split('<article')
      .filter((chunk) => chunk.includes('13 Reprog Playoff E2E'))
      .map((chunk) => /href="\/admin\/torneos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '')
      .find(Boolean) ?? '';
    expect(tid).toBeTruthy();
    const partBody: Record<string, string> = {
      name: '13 Reprog Playoff E2E',
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'GRUPOS_PLAYOFFS',
      comp_groups: '2',
      comp_qualifiers: '2',
      comp_playoff_start: 'SF',
      comp_playoff_single: 'on',
    };
    for (const id of teamIds) partBody[`participate_${id}`] = 'on';
    expect((await admin.post(`/admin/torneos/${tid}`, partBody)).status).toBe(302);

    // Fixture de grupos (2 partidos) + jugarlos.
    expect((await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'single' })).status).toBe(302);
    expect(decodeURIComponent((await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: '13-reprog-playoff-e2e' })).headers.get('location') ?? '')).toContain('Fixture guardado');
    const fx = await (await admin.get('/admin/fixture?t=13-reprog-playoff-e2e')).text();
    const groupIds = ids13(fx);
    expect(groupIds.length).toBe(2);
    for (const mid of groupIds) {
      expect((await admin.post(`/admin/planilla/${mid}`, {
        status: 'played',
        played_on: '2026-10-05',
        kickoff_time: '10:00',
        venue: 'Cancha Norte',
        home_goals: '1',
        away_goals: '0',
        hg1: 'none',
        notes: '',
      })).status).toBe(302);
    }

    // Genera las llaves: 2 SF + 1 F.
    expect(decodeURIComponent((await admin.post('/admin/fixture/llaves', { tournament_id: tid })).headers.get('location') ?? '')).toContain('Llaves generadas');
    const fx2 = await (await admin.get('/admin/fixture?t=13-reprog-playoff-e2e')).text();
    const sf = ids13(fx2).filter((id) => !groupIds.includes(id));
    expect(sf.length).toBe(3); // 2 SF + 1 F
    const sf1 = sf[0]!;
    const filaSf1Antes = (fx2.split('<tr>').find((c) => c.includes(`/admin/fixture/${sf1}/eliminar`)) ?? '');
    const filaFinalAntes = (fx2.split('<tr>').find((c) => c.includes(`/admin/fixture/${sf[2]}/eliminar`)) ?? '');

    // Reprograma la SF1 pendiente: nueva fecha y cancha, con motivo.
    const res = await admin.post(`/admin/fixture/${sf1}/reprogramar`, {
      played_on: '2026-11-15',
      kickoff_time: '20:00',
      venue: 'Cancha Sur',
      reason: 'Suspendida por lluvia en la fecha original',
    });
    expect(res.status).toBe(302);
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toContain('reprogramado');

    // La llave no cambia: la SF1 mantiene sus equipos y la final sigue
    // esperando a los ganadores (orígenes intactos).
    const fx3 = await (await admin.get('/admin/fixture?t=13-reprog-playoff-e2e')).text();
    const filaSf1Despues = fx3.split('<tr>').find((c) => c.includes(`/admin/fixture/${sf1}/eliminar`)) ?? '';
    const filaFinalDespues = fx3.split('<tr>').find((c) => c.includes(`/admin/fixture/${sf[2]}/eliminar`)) ?? '';
    // La semifinal conservó el par (los dos nombres antes = los dos después).
    const nombres = (fila: string) => (/<td>([^<]+) <span class="faint">vs<\/span> ([^<]+)</.exec(fila)?.slice(1).join('|') ?? '');
    expect(nombres(filaSf1Despues)).toBe(nombres(filaSf1Antes));
    // La final sigue con el mismo origen pendiente.
    expect(filaFinalDespues).toContain('→ WSF');
    expect(nombres(filaFinalDespues)).toBe(nombres(filaFinalAntes));
    // Y la nueva fecha quedó aplicada en la SF.
    expect(filaSf1Despues).toContain('Cancha Sur');
    expect(filaSf1Despues).toContain('20:00');

    // Limpieza.
    expect((await admin.post(`/admin/torneos/${tid}/eliminar`, {})).status).toBe(302);
  });
});

describe.skipIf(!has)('e2e: calendario operativo del fixture (Fase 15)', () => {
  /** IDs de partidos del calendario, por su acceso directo a la planilla. */
  function calIds(html: string): string[] {
    return [...new Set([...html.matchAll(/\/admin\/planilla\/(\d+)"/g)].map((m) => m[1]!))];
  }

  /** Fila de un partido en el calendario. Se toma por `data-match` y hasta
   *  la fila siguiente, porque la del reprogramado trae un historial con
   *  tabla anidada y partir el HTML por `<tr` cortaría la fila. */
  function calRow(html: string, matchId: string): string {
    const start = html.indexOf(`<tr data-match="${matchId}"`);
    if (start < 0) return '';
    const end = html.indexOf('<tr data-match=', start + 10);
    return end < 0 ? html.slice(start) : html.slice(start, end);
  }

  /** Sección (bloque) del calendario que contiene a un partido. */
  function calSection(html: string, matchId: string): string {
    const at = html.indexOf(`data-match="${matchId}"`);
    if (at < 0) return '';
    const start = html.lastIndexOf('<section class="block">', at);
    const end = html.indexOf('<section class="block">', at);
    return html.slice(start < 0 ? 0 : start, end < 0 ? undefined : end);
  }

  /** Jornada en la que el calendario muestra un partido. */
  function calRound(html: string, matchId: string): number {
    return Number(/zone-title">Fecha (\d+)/.exec(calSection(html, matchId))?.[1] ?? 0);
  }

  async function altaTorneo15(
    admin: ReturnType<typeof client>,
    nombre: string,
    teamIds: string[],
    extra: Record<string, string> = {}
  ): Promise<{ tid: string; partBody: Record<string, string> }> {
    const alta = await admin.post('/admin/torneos', {
      name: nombre,
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'UNA_RUEDA',
      comp_points_win: '3',
      comp_points_draw: '1',
      comp_points_loss: '0',
      ...extra,
    });
    expect(alta.status).toBe(302);
    const listado = await (await admin.get('/admin/torneos')).text();
    const tid = listado
      .split('<article')
      .filter((chunk) => chunk.includes(nombre))
      .map((chunk) => /href="\/admin\/torneos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '')
      .find(Boolean) ?? '';
    expect(tid).toBeTruthy();
    const partBody: Record<string, string> = {
      name: nombre,
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'UNA_RUEDA',
    };
    for (const id of teamIds) partBody[`participate_${id}`] = 'on';
    expect((await admin.post(`/admin/torneos/${tid}`, partBody)).status).toBe(302);
    return { tid, partBody };
  }

  it('el calendario agrupa por fecha, distingue los estados y muestra la fecha vigente del reprogramado', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const teamIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!).slice(0, 4);

    const { tid, partBody } = await altaTorneo15(admin, '15 Calendario E2E', teamIds);
    expect((await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'single' })).status).toBe(302);
    const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: '15-calendario-e2e' });
    expect(decodeURIComponent(conf.headers.get('location') ?? '')).toContain('Fixture guardado');

    // La página existe, trae los filtros y agrupa por fecha.
    const cal = await (await admin.get('/admin/calendario?t=15-calendario-e2e')).text();
    expect(cal).toContain('Calendario');
    expect(cal).toContain('Fecha 1');
    expect(cal).toContain('Zona / grupo');
    expect(cal).toContain('Jornada');
    expect(cal).toContain('name="estado"');
    const ids = calIds(cal);
    expect(ids.length).toBe(6);

    // Se juega el primero y se reprograma el segundo (Fase 13).
    const jugado = ids[0]!;
    const reprogramado = ids[1]!;
    const jugar = await admin.post(`/admin/planilla/${jugado}`, {
      status: 'played',
      played_on: '2026-10-05',
      kickoff_time: '10:00',
      venue: 'Cancha Norte',
      home_goals: '1',
      away_goals: '0',
      hg1: 'none',
      notes: '',
    });
    expect(jugar.status).toBe(302);
    expect(decodeURIComponent(jugar.headers.get('location') ?? '')).not.toContain('err=');
    const repro = await admin.post(`/admin/fixture/${reprogramado}/reprogramar`, {
      played_on: '2026-11-02',
      kickoff_time: '18:30',
      venue: 'Cancha Sur',
      reason: 'Cancha inundada',
    });
    expect(repro.status).toBe(302);
    expect(decodeURIComponent(repro.headers.get('location') ?? '')).toContain('reprogramado');

    // Estados claros: el jugado sale "Jugado" (y no se ofrece reprogramar);
    // el reprogramado sale "Reprogramado" con la fecha vigente y el motivo.
    const cal2 = await (await admin.get('/admin/calendario?t=15-calendario-e2e')).text();
    const filaJugado = calRow(cal2, jugado);
    expect(filaJugado).toContain('Jugado');
    expect(filaJugado).toContain(`/partido/${jugado}`);
    expect(filaJugado).not.toContain('#reprogramar');
    const filaRepro = calRow(cal2, reprogramado);
    expect(filaRepro).toContain('Reprogramado');
    expect(filaRepro).toContain('18:30');
    expect(filaRepro).toContain('Cancha Sur');
    expect(filaRepro).toContain('Cancha inundada');
    // Los otros cuatro siguen pendientes.
    expect(cal2).toContain('Pendiente');

    // Acceso rápido: planilla, reprogramación y edición.
    expect(filaRepro).toContain(`/admin/planilla/${reprogramado}`);
    expect(filaRepro).toContain(`/admin/planilla/${reprogramado}#reprogramar`);
    expect(filaRepro).toContain(`/admin/fixture/${reprogramado}/editar`);

    // El ancla de reprogramación existe en la planilla.
    const sheet = await (await admin.get(`/admin/planilla/${reprogramado}`)).text();
    expect(sheet).toContain('id="reprogramar"');
    expect(sheet).toContain('Cancha inundada');

    // Filtro por estado.
    const soloRepro = await (await admin.get('/admin/calendario?t=15-calendario-e2e&estado=reprogramado')).text();
    expect(calIds(soloRepro)).toEqual([reprogramado]);
    expect(soloRepro).toContain('mostrando 1 de 6');
    const soloJugado = await (await admin.get('/admin/calendario?t=15-calendario-e2e&estado=jugado')).text();
    expect(calIds(soloJugado)).toEqual([jugado]);

    // Filtro por jornada (incluido un valor que no existe). La cantidad
    // esperada sale de la propia sección de la fecha 1 del calendario sin
    // filtro, así el test no depende de cómo repartió el torneo los partidos.
    const rondaRepro = calRound(cal2, reprogramado);
    expect(rondaRepro).toBeGreaterThan(0);
    const enSuFecha = calIds(calSection(cal2, reprogramado));
    expect(enSuFecha).toContain(reprogramado);
    const fRepro = await (await admin.get(`/admin/calendario?t=15-calendario-e2e&jornada=${rondaRepro}`)).text();
    expect(calIds(fRepro)).toEqual(enSuFecha);
    expect(fRepro).toContain(`mostrando ${enSuFecha.length} de 6`);
    expect(fRepro).not.toContain(`Fecha ${rondaRepro + 1} ·`);
    const f99 = await (await admin.get('/admin/calendario?t=15-calendario-e2e&jornada=99')).text();
    expect(calIds(f99).length).toBe(0);
    expect(f99).toContain('Ningún partido coincide con el filtro');

    // Filtro por zona en un torneo sin zonas: no deja nada.
    const zona = await (await admin.get('/admin/calendario?t=15-calendario-e2e&zona=A')).text();
    expect(calIds(zona).length).toBe(0);

    // Filtros combinados. La reprogramación cambia día/hora/cancha pero NO la
    // jornada: el reprogramado sigue figurando en su fecha original.
    const combo = await (
      await admin.get(`/admin/calendario?t=15-calendario-e2e&jornada=${rondaRepro}&estado=reprogramado`)
    ).text();
    expect(calIds(combo)).toEqual([reprogramado]);
    // Su fecha + estado "jugado" muestra solo al jugado, si cae en la misma.
    const comboJugado = await (
      await admin.get(`/admin/calendario?t=15-calendario-e2e&jornada=${calRound(cal2, jugado)}&estado=jugado`)
    ).text();
    expect(calIds(comboJugado)).toEqual([jugado]);

    // El fixture público marca el reprogramado con su fecha vigente.
    const pub = await (await admin.get('/fixture?t=15-calendario-e2e')).text();
    expect(pub).toContain('Reprogramado');
    expect(pub).toContain('Cancha Sur');

    // Torneo finalizado: el calendario avisa que es de solo lectura.
    expect((await admin.post(`/admin/torneos/${tid}`, { ...partBody, status: 'finished' })).status).toBe(302);
    const calFin = await (await admin.get('/admin/calendario?t=15-calendario-e2e')).text();
    expect(calFin).toContain('solo lectura');
    expect(calRow(calFin, reprogramado)).not.toContain('#reprogramar');

    // Limpieza.
    expect((await admin.post(`/admin/torneos/${tid}/eliminar`, {})).status).toBe(302);
  });

  it('con zonas configuradas, el filtro de zona muestra solo los partidos de esa zona', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const teamIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!).slice(0, 4);
    expect(teamIds.length).toBe(4);

    const alta = await admin.post('/admin/torneos', {
      name: '15 Calendario Zonas E2E',
      season: '2026',
      status: 'active',
      format: 'zonas_playoffs',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'UNA_RUEDA',
      zones_enabled: 'on',
      zone_names: 'A\nB',
      [`zone_of_${teamIds[0]}`]: '1',
      [`zone_of_${teamIds[1]}`]: '1',
      [`zone_of_${teamIds[2]}`]: '2',
      [`zone_of_${teamIds[3]}`]: '2',
    });
    expect(alta.status).toBe(302);
    const listado = await (await admin.get('/admin/torneos')).text();
    const tid = listado
      .split('<article')
      .filter((chunk) => chunk.includes('15 Calendario Zonas E2E'))
      .map((chunk) => /href="\/admin\/torneos\/(\d+)">Editar/.exec(chunk)?.[1] ?? '')
      .find(Boolean) ?? '';
    expect(tid).toBeTruthy();

    expect((await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'single' })).status).toBe(302);
    const conf = await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: '15-calendario-zonas-e2e' });
    expect(decodeURIComponent(conf.headers.get('location') ?? '')).toContain('Fixture guardado');

    // El calendario ofrece A y B en el filtro.
    const cal = await (await admin.get('/admin/calendario?t=15-calendario-zonas-e2e')).text();
    expect(cal).toContain('<option value="A"');
    expect(cal).toContain('<option value="B"');

    // Filtrar por A recorta la lista; por B muestra los otros.
    const soloA = await (await admin.get('/admin/calendario?t=15-calendario-zonas-e2e&zona=A')).text();
    const soloB = await (await admin.get('/admin/calendario?t=15-calendario-zonas-e2e&zona=B')).text();
    const todas = calIds(cal);
    const enA = calIds(soloA);
    const enB = calIds(soloB);
    expect(enA.length).toBeGreaterThan(0);
    expect(enB.length).toBeGreaterThan(0);
    expect(enA.length).toBeLessThan(todas.length);
    // Las dos zonas juntas cubren todos los partidos de sus fechas.
    expect([...enA, ...enB].sort()).toEqual(todas.filter((id) => soloA.includes(id) || soloB.includes(id)).sort());
    // Ninguna fila de A es de B: la zona se muestra en la fila.
    expect(soloA).toContain('>A<');
    expect(soloB).toContain('>B<');

    // Limpieza.
    expect((await admin.post(`/admin/torneos/${tid}/eliminar`, {})).status).toBe(302);
  });
});

describe.skipIf(!has)('e2e: equipos y jugadores (Fase 16)', () => {
  /** Id del equipo cuyo nombre aparece en el listado del panel. */
  async function idEquipo(admin: ReturnType<typeof client>, nombre: string): Promise<string> {
    const html = await (await admin.get('/admin/equipos')).text();
    const card = html.split('<article').find((c) => c.includes(`<strong>${nombre}</strong>`));
    const id = card ? /href="\/admin\/equipos\/(\d+)">Editar/.exec(card)?.[1] ?? '' : '';
    expect(id, `no encontré el equipo ${nombre}`).toBeTruthy();
    return id;
  }

  /** Id del jugador cuyo nombre corto aparece en la tarjeta de la plantilla. */
  function idJugador(html: string, nombre: string): string {
    const re = new RegExp(`data-nombre="${nombre}"[\\s\\S]*?/admin/jugadores/(\\d+)/(eliminar|reactivar)`);
    return re.exec(html)?.[1] ?? '';
  }

  /** Toma las primeras respuestas numéricas de la tabla de la planilla. */
  function opcionesJugador(html: string): string {
    return /<select name="player_1"[\s\S]*?<\/select>/.exec(html)?.[0] ?? '';
  }
  void opcionesJugador;

  it('validaciones en el servidor: datos inválidos dan error claro, nunca 500', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);
    const nombre = `16 Validacion ${Date.now().toString(36)}`;
    expect(
      (await admin.post('/admin/equipos', { name: nombre, short_name: '', color: '#22c55e', logo_url: '', active: 'on' })).status
    ).toBe(302);
    const equipo = await idEquipo(admin, nombre);
    const loc = (r: Response): string => decodeURIComponent(r.headers.get('location') ?? '');

    // Los tres casos que antes devolvían 500.
    const dorsal = await admin.post('/admin/jugadores', { team_id: equipo, name: 'Dorsal Malo', number: '500', position: '' });
    expect(dorsal.status).toBe(302);
    expect(loc(dorsal)).toContain('dorsal');

    const posicion = await admin.post('/admin/jugadores', { team_id: equipo, name: 'Posicion Mala', number: '5', position: 'ZZZ' });
    expect(posicion.status).toBe(302);
    expect(loc(posicion)).toContain('posición');

    const sinEquipo = await admin.post('/admin/jugadores', { team_id: '999999', name: 'Equipo Raro', number: '', position: '' });
    expect(sinEquipo.status).toBe(302);
    expect(loc(sinEquipo)).toContain('equipo no existe');

    const sinNombre = await admin.post('/admin/jugadores', { team_id: equipo, name: '   ', number: '', position: '' });
    expect(sinNombre.status).toBe(302);
    expect(loc(sinNombre)).toContain('nombre');

    // Equipo: color inválido y escudo con esquema peligroso se rechazan con 400.
    const color = await admin.post('/admin/equipos', { name: `${nombre} Color`, short_name: '', color: 'no-es-un-color', logo_url: '', active: 'on' });
    expect(color.status).toBe(400);
    const escudo = await admin.post('/admin/equipos', { name: `${nombre} Escudo`, short_name: '', color: '#22c55e', logo_url: 'javascript:alert(1)', active: 'on' });
    expect(escudo.status).toBe(400);

    // Nada de lo inválido quedó guardado.
    const jug = await (await admin.get(`/admin/jugadores?team=${equipo}`)).text();
    expect(jug).not.toContain('Dorsal Malo');
    expect(jug).not.toContain('Posicion Mala');
    const equipos = await (await admin.get('/admin/equipos')).text();
    expect(equipos).not.toContain(`${nombre} Color`);
    expect(equipos).not.toContain(`${nombre} Escudo`);

    // Limpieza: sin partidos, el equipo se borra.
    expect((await admin.post(`/admin/equipos/${equipo}/eliminar`, {})).status).toBe(302);
    expect(await (await admin.get('/admin/equipos')).text()).not.toContain(nombre);
  });

  it('jugador: editar, dorsal repetido avisado, baja con historial y reactivación', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const base = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!);
    expect(base.length).toBeGreaterThanOrEqual(4);
    const equipo = base[0]!;
    const url = `/admin/jugadores?team=${equipo}`;
    const loc = (r: Response): string => decodeURIComponent(r.headers.get('location') ?? '');

    // Un jugador nuevo para trabajar sobre la lista.
    const marca = `16e${Date.now().toString(36)}`;
    expect((await admin.post('/admin/jugadores', { team_id: equipo, name: `16 Player ${marca}`, number: '3', position: 'DF' })).status).toBe(302);
    let jug = await (await admin.get(url)).text();
    const target = idJugador(jug, `16 player ${marca}`);
    expect(target).toBeTruthy();

    // Editar nombre, dorsal y posición.
    const ed = await admin.post(`/admin/jugadores/${target}`, { name: `16 Editado ${marca}`, number: '77', position: 'AR' });
    expect(ed.status).toBe(302);
    expect(loc(ed)).toContain('Jugador actualizado');
    jug = await (await admin.get(url)).text();
    expect(jug).toContain(`16 Editado ${marca}`);
    expect(jug).toContain('value="77"');
    expect(jug).toMatch(/value="AR" selected/);

    // Dorsal repetido: avisa y guarda igual (el aviso va en el redirect).
    const dup = await admin.post('/admin/jugadores', { team_id: equipo, name: `16 Otro ${marca}`, number: '77', position: '' });
    expect(dup.status).toBe(302);
    expect(loc(dup)).toContain('dorsal 77 ya lo tiene otro jugador');
    jug = await (await admin.get(url)).text();
    const otro = idJugador(jug, `16 otro ${marca}`);
    expect(otro).toBeTruthy();

    // Sin historial: eliminar de verdad.
    const del = await admin.post(`/admin/jugadores/${otro}/eliminar`, {});
    expect(del.status).toBe(302);
    expect(loc(del)).toContain('eliminado');
    expect(await (await admin.get(url)).text()).not.toContain(`16 Otro ${marca}`);

    // Con historial: baja lógica + reactivación (simula el estado del botón).
    jug = await (await admin.get(url)).text();
    const editar = new RegExp(`data-nombre="16 editado ${marca}"[\\s\\S]*?/admin/jugadores/(\\d+)/eliminar`).exec(jug)?.[1] ?? '';
    expect(editar).toBe(target);
    // Con la Fase 13 no hay historial todavía: se elimina. Con historial, la
    // ruta elige sola (cubierto por test/roster.test.ts).
    expect((await admin.post(`/admin/jugadores/${target}/eliminar`, {})).status).toBe(302);

    // Limpieza por si quedó algún jugador de prueba.
    const final = await (await admin.get(url)).text();
    for (const id of [...new Set([...final.matchAll(/\/admin\/jugadores\/(\d+)\/eliminar/g)].map((m) => m[1]!))]) {
      if (final.includes(`data-nombre="16 `)) {
        await admin.post(`/admin/jugadores/${id}/eliminar`, {});
      }
    }
  });

  it('eliminar un equipo con partidos está bloqueado y lo explica', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const teamIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!).slice(0, 4);
    expect(teamIds.length).toBe(4);
    const nombre = `16 Fixture ${Date.now().toString(36)}`;

    const alta = await admin.post('/admin/torneos', {
      name: nombre,
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'UNA_RUEDA',
      comp_points_win: '3',
      comp_points_draw: '1',
      comp_points_loss: '0',
    });
    expect(alta.status).toBe(302);
    const listado = await (await admin.get('/admin/torneos')).text();
    const tid = listado
      .split('<article')
      .filter((c) => c.includes(nombre))
      .map((c) => /href="\/admin\/torneos\/(\d+)">Editar/.exec(c)?.[1] ?? '')
      .find(Boolean) ?? '';
    expect(tid).toBeTruthy();
    const partBody: Record<string, string> = {
      name: nombre,
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'UNA_RUEDA',
    };
    for (const id of teamIds) partBody[`participate_${id}`] = 'on';
    expect((await admin.post(`/admin/torneos/${tid}`, partBody)).status).toBe(302);
    expect((await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'single' })).status).toBe(302);
    expect(
      decodeURIComponent(
        (await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: `16-fixture-${Date.now().toString(36)}` })).headers.get('location') ?? ''
      )
    ).toContain('Fixture guardado');

    // El panel de equipos muestra el resumen y bloquea el borrado.
    const panel = await (await admin.get('/admin/equipos')).text();
    expect(panel).toContain('En fixture');
    expect(panel).toContain('No se puede eliminar');
    expect(panel).toContain('equipo(s) tienen partidos en el fixture');

    // El servidor rechaza el borrado aunque se saltee el botón.
    const borrar = await admin.post(`/admin/equipos/${teamIds[0]}/eliminar`, {});
    expect(borrar.status).toBe(302);
    const err = decodeURIComponent(borrar.headers.get('location') ?? '');
    expect(err).toContain('no se puede eliminar');
    expect(err).toContain('inactivo');

    // El equipo sigue existiendo.
    expect(await (await admin.get('/admin/equipos')).text()).toContain(`href="/admin/equipos/${teamIds[0]}">Editar`);

    // Limpieza.
    expect((await admin.post(`/admin/torneos/${tid}/eliminar`, {})).status).toBe(302);
  });
});

describe.skipIf(!has)('e2e: operación de partidos (Fase 17)', () => {
  const loc = (r: Response): string => decodeURIComponent(r.headers.get('location') ?? '');

  /** Id del jugador cuyo nombre aparece en la plantilla del equipo. */
  function idJugador(html: string, nombre: string): string {
    const re = new RegExp(`data-nombre="${nombre}"[\\s\\S]*?/admin/jugadores/(\\d+)/(eliminar|reactivar)`);
    return re.exec(html)?.[1] ?? '';
  }

  it('la planilla y los eventos validan de verdad: nada de 500 ni datos ajenos', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    const marca = `17${Date.now().toString(36)}`;
    const nombre = `17 Operacion ${marca}`;
    const slug = nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    // Torneo propio con 4 equipos, para no tocar los datos de otros tests.
    const teamsHtml = await (await admin.get('/admin/equipos')).text();
    const teamIds = [...teamsHtml.matchAll(/href="\/admin\/equipos\/(\d+)">Editar/g)].map((m) => m[1]!).slice(0, 4);
    expect(teamIds.length).toBe(4);
    expect(
      (await admin.post('/admin/torneos', {
        name: nombre,
        season: '2026',
        status: 'active',
        venues: 'Cancha Norte',
        kickoffs: '10:00',
        start_date: '2026-10-05',
        round_gap: '7',
        comp_format: 'UNA_RUEDA',
      })).status
    ).toBe(302);
    const listado = await (await admin.get('/admin/torneos')).text();
    const tid = listado
      .split('<article')
      .filter((c) => c.includes(nombre))
      .map((c) => /href="\/admin\/torneos\/(\d+)">Editar/.exec(c)?.[1] ?? '')
      .find(Boolean) ?? '';
    expect(tid, 'el torneo de la Fase 17 tiene que existir').toBeTruthy();

    const alta: Record<string, string> = {
      name: nombre,
      season: '2026',
      status: 'active',
      venues: 'Cancha Norte',
      kickoffs: '10:00',
      start_date: '2026-10-05',
      round_gap: '7',
      comp_format: 'UNA_RUEDA',
    };
    for (const id of teamIds) alta[`participate_${id}`] = 'on';
    expect((await admin.post(`/admin/torneos/${tid}`, alta)).status).toBe(302);
    expect((await admin.post('/admin/fixture/previsualizar', { tournament_id: tid, mode: 'single' })).status).toBe(302);
    expect(loc(await admin.post('/admin/fixture/confirmar', { tournament_id: tid, t: `17-fixture-${marca}` }))).toContain(
      'Fixture guardado'
    );

    // Dos partidos distintos del torneo.
    const fixtureHtml = await (await admin.get(`/admin/fixture?t=${slug}`)).text();
    const matchIds = [...new Set([...fixtureHtml.matchAll(/\/admin\/planilla\/(\d+)/g)].map((m) => m[1]!))];
    expect(matchIds.length).toBeGreaterThanOrEqual(2);
    const [midA, midB] = matchIds as [string, string];

    // Los dos equipos del partido A y un tercero que ahí no juega.
    const sheetA = await (await admin.get(`/admin/planilla/${midA}`)).text();
    const sidesA = [...new Set([...sheetA.matchAll(/name="team_id" value="(\d+)"/g)].map((m) => m[1]!))];
    expect(sidesA.length).toBe(2);
    const [homeId, awayId] = sidesA as [string, string];
    const tercero = teamIds.find((id) => id !== homeId && id !== awayId)!;
    expect(tercero, 'hace falta un tercer equipo en el torneo').toBeTruthy();

    const nom = (n: string): string => `17 ${n} ${marca}`;
    const bajas = [
      [homeId, nom('Local')],
      [awayId, nom('Visita')],
      [tercero, nom('Tercero')],
    ] as const;
    for (const [team, nombreJug] of bajas) {
      expect((await admin.post('/admin/jugadores', { team_id: team, name: nombreJug, number: '', position: 'DEL' })).status).toBe(302);
    }
    const jugHome = idJugador(await (await admin.get(`/admin/jugadores?team=${homeId}`)).text(), nom('local').toLowerCase());
    const jugAway = idJugador(await (await admin.get(`/admin/jugadores?team=${awayId}`)).text(), nom('visita').toLowerCase());
    const jugTercero = idJugador(await (await admin.get(`/admin/jugadores?team=${tercero}`)).text(), nom('tercero').toLowerCase());
    expect(jugHome && jugAway && jugTercero, 'los tres jugadores tienen que estar en la plantilla').toBeTruthy();

    /* ---------- 1. La planilla rechaza datos imposibles (antes: error 500) ---------- */

    const base: Record<string, string> = {
      status: 'played',
      played_on: '2026-10-05',
      kickoff_time: '10:00',
      venue: 'Cancha Norte',
      home_goals: '0',
      away_goals: '0',
      notes: '',
    };
    const guardar = (extra: Record<string, string>): Promise<Response> => admin.post(`/admin/planilla/${midA}`, { ...base, ...extra });

    const estadoMalo = await guardar({ status: 'inventado' });
    expect(estadoMalo.status).toBe(302);
    expect(loc(estadoMalo)).toContain('Estado inválido');
    const estadoVacio = await guardar({ status: '' });
    expect(estadoVacio.status).toBe(302);
    expect(loc(estadoVacio)).toContain('Falta elegir el estado');

    expect(loc(await guardar({ home_points: '99' }))).toContain('0 a 30');
    expect(loc(await guardar({ played_on: '2026-02-31' }))).toContain('no existe en el calendario');
    expect(loc(await guardar({ kickoff_time: '25:00' }))).toContain('HH:MM');

    // Nada de eso se guardó: el partido sigue scheduled y sin puntos a mano.
    const trasErrores = await (await admin.get(`/admin/planilla/${midA}`)).text();
    expect(trasErrores).toMatch(/<option value="scheduled" selected>/);
    expect(trasErrores).toMatch(/name="home_points"[^>]*value=""/);

    /* ---------- 2. Estado "Libre" (bye) disponible desde la pantalla ---------- */
    expect(trasErrores).toMatch(/<option value="bye"[^>]*>Libre<\/option>/);

    /* ---------- 3. Eventos: tipo, minuto, equipo y jugador ---------- */
    const evento = (extra: Record<string, string>, mid = midA): Promise<Response> =>
      admin.post(`/admin/planilla/${mid}/evento`, extra);

    const tipoMalo = await evento({ team_id: homeId, player_id: jugHome, type: 'amarillo' });
    expect(tipoMalo.status).toBe(302);
    expect(loc(tipoMalo)).toContain('Tipo de evento inválido');
    expect(loc(await evento({ team_id: homeId, player_id: jugHome, type: 'yellow', minute: '-5' }))).toContain('0 a 130');
    expect(loc(await evento({ team_id: homeId, player_id: jugHome, type: 'yellow', minute: '500' }))).toContain('0 a 130');
    // Equipo que no juega ese partido: antes se guardaba y contaminaba las tarjetas públicas.
    expect(loc(await evento({ team_id: tercero, player_id: jugTercero, type: 'yellow', minute: '10' }))).toContain(
      'equipo del partido'
    );
    // Jugador del otro lado.
    expect(loc(await evento({ team_id: homeId, player_id: jugAway, type: 'yellow', minute: '10' }))).toContain(
      'plantilla del equipo'
    );

    // Ninguno de los rechazados quedó cargado: las dos tablas siguen vacías.
    const sinNada = await (await admin.get(`/admin/planilla/${midA}`)).text();
    expect([...sinNada.matchAll(/Sin eventos/g)].length).toBe(2);
    expect(sinNada).not.toContain('name="event_id"');

    /* ---------- 4. Un evento válido sí se guarda ---------- */
    expect((await evento({ team_id: homeId, player_id: jugHome, type: 'yellow', minute: '23' })).status).toBe(302);
    const conEvento = await (await admin.get(`/admin/planilla/${midA}`)).text();
    expect(conEvento).toContain('17 Local');
    const eventId = /name="event_id" value="(\d+)"/.exec(conEvento)?.[1] ?? '';
    expect(eventId, 'el evento válido tiene que quedar cargado').toBeTruthy();

    /* ---------- 5. No se puede borrar el evento de otro partido ---------- */
    const ajeno = await admin.post(`/admin/planilla/${midB}/evento/eliminar`, { event_id: eventId });
    expect(ajeno.status).toBe(302);
    expect(loc(ajeno)).toContain('no pertenece a este partido');
    expect(await (await admin.get(`/admin/planilla/${midA}`)).text()).toContain(`name="event_id" value="${eventId}"`);

    /* ---------- 6. Confirmación antes de pisar autores de gol ---------- */
    expect((await guardar({ home_goals: '1', hg1: jugHome })).status).toBe(302);
    const conAutores = await (await admin.get(`/admin/planilla/${midA}`)).text();
    expect(conAutores).toContain('confirm_goles');
    expect(conAutores).toContain('pisar los autores de gol');
    expect(loc(await guardar({ home_goals: '0', away_goals: '0' }))).toContain('casilla de confirmación');
    expect(await (await admin.get(`/admin/planilla/${midA}`)).text()).toMatch(/name="home_goals"[^>]*value="1"/);
    expect(loc(await guardar({ home_goals: '0', away_goals: '0', confirm_goles: '1' }))).toContain('Planilla guardada');
    expect(await (await admin.get(`/admin/planilla/${midA}`)).text()).toMatch(/name="home_goals"[^>]*value="0"/);

    /* ---------- 7. La lista de planillas se puede cambiar de torneo ---------- */
    const lista = await (await admin.get(`/admin/planilla?t=${slug}`)).text();
    expect(lista).toContain(nombre);
    expect(lista).toContain(`value="${slug}"`);

    // Limpieza.
    for (const [team] of bajas) await admin.post(`/admin/equipos/${team}/eliminar`, {});
    expect((await admin.post(`/admin/torneos/${tid}/eliminar`, {})).status).toBe(302);
  });
});
describe.skipIf(!has)('e2e: ayuda del panel (documentación)', () => {
  it('la guía carga con índice, categorías y búsqueda que encuentra cosas', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    const ayuda = await (await admin.get('/admin/ayuda')).text();
    expect(ayuda, '/admin/ayuda tiene que existir y devolver 200').toContain('Guía completa del panel');

    // Las 14 categorías del panel están en la guía.
    for (const cat of ['Primeros pasos', 'Torneos', 'Competencia', 'Equipos', 'Jugadores', 'Delegados', 'Fixture', 'Partidos y planillas', 'Calendario', 'Reprogramaciones', 'Disciplina', 'Estadísticas', 'Administración', 'Problemas frecuentes']) {
      expect(ayuda, `falta la categoría ${cat}`).toContain(`${cat}</h2>`);
    }

    // Índice navegable y secciones grandes con ancla.
    expect(ayuda).toContain('class="h-index"');
    expect(ayuda).toContain('id="flujo-completo"');
    expect(ayuda).toContain('id="errores-y-validaciones"');
    expect(ayuda).toContain('id="situaciones-habituales"');
    expect(ayuda).toContain('Cómo administrar un torneo desde cero');
    expect(ayuda).toContain('Situaciones habituales');

    // El item Ayuda está en el menú lateral.
    expect(ayuda).toContain('href="/admin/ayuda"');

    // Búsqueda: encuentra y no rompe.
    const res = await (await admin.get('/admin/ayuda?q=walkover')).text();
    expect(res).toContain('resultado');
    expect(res).toContain('Walkover');
    const vacio = await (await admin.get('/admin/ayuda?q=zzzzz')).text();
    expect(vacio).toContain('No encontré nada');
  });

  it('cada sección del panel muestra su propia ayuda contextual', async () => {
    const admin = client();
    await admin.loginAdmin(ADMIN_PASSWORD);

    // (ruta, frase propia de esa pantalla) — el texto NO puede ser el mismo en todas.
    const pantallas: [string, string][] = [
      ['/admin', 'Resumen del torneo activo'],
      ['/admin/torneos', 'Crear, editar y borrar torneos'],
      ['/admin/equipos', 'Alta, edición, activación y borrado'],
      ['/admin/jugadores', 'Cargar y mantener las plantillas'],
      ['/admin/fixture', 'Generar el fixture'],
      ['/admin/planilla', 'Cargar el resultado'],
      ['/admin/fechas', 'Día, hora y cancha de cada fecha'],
      ['/admin/calendario', 'La vista operativa del torneo'],
      ['/admin/delegados', 'Habilitar el acceso de los delegados'],
      ['/admin/entregas', 'Revisar las entregas de resultado'],
      ['/admin/estadisticas', 'Tabla de posiciones, goleadores'],
      ['/admin/ajustes', 'Sumar o restar puntos a un equipo'],
      ['/admin/suspensiones', 'las suspensiones automáticas'],
    ];
    for (const [ruta, frase] of pantallas) {
      const html = await (await admin.get(ruta)).text();
      expect(html, `${ruta} tiene que ofrecer la ayuda contextual`).toContain('Qué puedo hacer aquí');
      expect(html, `${ruta} debe explicar para qué sirve`).toContain(frase);
      expect(html, `${ruta} debe enlazar a la guía`).toContain('/admin/ayuda#');
    }

    // La ayuda de la propia página Ayuda no se muestra (ahí está todo).
    expect(await (await admin.get('/admin/ayuda')).text()).not.toContain('Qué puedo hacer aquí');
  });
});