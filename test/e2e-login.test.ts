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
    expect(page).toContain('deshabilitado');
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
