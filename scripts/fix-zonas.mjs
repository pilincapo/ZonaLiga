// Reasigna las zonas en paradas iguales ("mitad y mitad") a los equipos
// activos del torneo y regenera el fixture.
//
// ⚠️ Generar fixture BORRA todos los partidos del torneo. Si hay resultados
// cargados, el script FRENA: el panel se niega por diseño a borrar partidos
// jugados. En ese caso usá "↻ Regenerar cruce" desde el panel (conserva lo
// jugado y rearma los pendientes) o borrá los resultados primero.
//
// A diferencia de una versión vieja de este script, NO pisa el resto de la
// config del torneo: lee el formulario del torneo tal como está (nombre,
// canchas, horarios, reglas…) y lo reenvía igual, cambiando solo las zonas.
//
// Uso:
//   node scripts/fix-zonas.mjs [baseUrl] [torneo]
//   node scripts/fix-zonas.mjs http://127.0.0.1:8790 2
//
//   baseUrl  default: http://127.0.0.1:8790 (wrangler dev --port 8790)
//   torneo   id numérico o slug (default: el torneo activo).
//            Ej.: 2 · torneo-2026 · liga-de-prueba-2026
//
// Requiere ADMIN_PASSWORD solo si el entorno la configuró (en dev local no).
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'zonaliga-dev-secret-change-me';

const argv = process.argv.slice(2);
const BASE = argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:8790';
const target = argv.find((a) => !a.startsWith('http')) ?? '';

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

// ── elegir torneo: por id/slug, o el activo ─────────────────────────────────
const list = await (await req('/admin/torneos')).text();
const tournaments = [...list.matchAll(/<a href="\/\?t=([^"]+)"><strong>([^<]+)<\/strong><\/a><\/td>[\s\S]{0,200}?\/admin\/torneos\/(\d+)">Editar/g)]
  .map((m) => ({ slug: m[1], name: m[2], id: Number(m[3]) }));
if (tournaments.length === 0) throw new Error('no hay torneos cargados');

let chosen;
if (target) {
  chosen = /^\d+$/.test(target)
    ? tournaments.find((t) => t.id === Number(target))
    : tournaments.find((t) => t.slug === target);
  if (!chosen) throw new Error(`no encontré el torneo "${target}". Disponibles: ${tournaments.map((t) => `${t.name} (id ${t.id}, ${t.slug})`).join(' · ')}`);
} else {
  const active = await (await req('/')).text();
  chosen = tournaments.find((t) => active.includes(`/?t=${t.slug}"`));
  chosen = chosen ?? tournaments[tournaments.length - 1];
  console.log(`— sin torneo indicado; uso el activo: ${chosen.name} (id ${chosen.id})`);
}
console.log(`Torneo: ${chosen.name} (id ${chosen.id}, slug ${chosen.slug})`);

// ── leer el formulario del torneo: es la ÚNICA fuente de la config ─────────
// Reenviamos el formulario tal cual está (canchas, horarios, reglas…) y
// cambiamos solo los selects de zona. Así no se pierde nada.
const formHtml = await (await req(`/admin/torneos/${chosen.id}`)).text();
const formAction = new RegExp(`<form method="post" action="/admin/torneos/${chosen.id}">`);
if (!formAction.test(formHtml)) throw new Error('no encontré el formulario del torneo (¿cambió el panel?)');

const fields = new URLSearchParams();
// Solo el bloque del form (evita confundir el JS de la página con campos).
const formBlock = /<form method="post" action="\/admin\/torneos\/\d+">[\s\S]*?<\/form>/.exec(formHtml)?.[0];
if (!formBlock) throw new Error('no pude aislar el formulario del torneo');
// inputs con name y value (los checkboxes van aparte).
for (const m of formBlock.matchAll(/<input\b[^>]*name="([^"]+)"[^>]*>/g)) {
  if (/type="(?:checkbox|radio|submit|button)"/.test(m[0])) continue;
  fields.set(m[1], /\bvalue="([^"]*)"/.exec(m[0])?.[1] ?? '');
}
// selects: la opción con `selected` (o la primera si ninguna lo está).
for (const m of formBlock.matchAll(/<select\b[^>]*?name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
  const opts = [...m[2].matchAll(/<option\b[^>]*>/g)];
  const chosen = opts.find((o) => /\bselected/.test(o[0])) ?? opts[0];
  fields.set(m[1], chosen ? (/\bvalue="([^"]*)"/.exec(chosen[0])?.[1] ?? '') : '');
}
// textareas: el contenido tal cual.
for (const m of formBlock.matchAll(/<textarea\b[^>]*?name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) {
  fields.set(m[1], m[2]);
}
// checkboxes marcados (hoy: zones_enabled, showAdvanced).
for (const m of formBlock.matchAll(/<input[^>]*type="checkbox"[^>]*name="([^"]+)"[^>]*checked[^>]*>/g)) {
  fields.set(m[1], 'on');
}

// ── equipos activos del panel (fila: nombre → estado → Editar) ──────────────
const teamsHtml = await (await req('/admin/equipos')).text();
const rows = [
  ...teamsHtml.matchAll(
    /<strong>([^<]+)<\/strong><\/a>[\s\S]{0,500}?(\/admin\/equipos\/(\d+)">Editar|badge ghost">Inactivo)/g
  ),
];
const active = [];
for (const m of rows) {
  if (m[2].includes('Inactivo')) continue;
  active.push({ name: m[1], id: Number(m[3]) });
}
console.log(`equipos activos: ${active.length}`);
if (active.length < 4) throw new Error('se necesitan al menos 4 equipos activos');

// ── advertencia y confirmación si el fixture ya tiene partidos jugados ─────
// La página pública muestra cada partido con resultado como un link de score
// ("2 - 1"); los pendientes muestran "- : -". Cuento los links con goles.
const fx = await (await req(`/fixture?t=${chosen.slug}`)).text();
const jugados = (fx.match(/\/partido\/\d+">\d+ - \d+</g) ?? []).length;
if (jugados > 0) {
  console.error(`\n⚠️  El torneo tiene ${jugados} partido(s) con resultado cargado.`);
  console.error('   Regenerar el fixture los BORRA y el panel se niega a hacerlo: no se puede seguir.');
  console.error('   Opciones: "↻ Regenerar cruce" desde el panel (conserva lo jugado), o borrá los');
  console.error('   resultados primero y volvé a correr este script.');
  process.exit(1);
}

// ── reasignar zonas: primera mitad a la A, segunda a la B ──────────────────
const perZone = Math.ceil(active.length / 2);
fields.set('zones_enabled', 'on');
fields.set('zone_names', 'A\nB');
active.forEach((t, i) => fields.set(`zone_of_${t.id}`, i < perZone ? '1' : '2'));

const upd = await req(`/admin/torneos/${chosen.id}`, { method: 'POST', body: fields });
if (upd.status !== 302) throw new Error('guardar zonas: ' + upd.status);
console.log(`✓ zonas reasignadas: ${perZone} en A y ${active.length - perZone} en B`);

// ── fixture por zonas ───────────────────────────────────────────────────────
const gen = await req('/admin/fixture/previsualizar', { method: 'POST', body: form({ tournament_id: chosen.id, mode: 'single' }) });
const prevLoc = decodeURIComponent(gen.headers.get('location') ?? '');
if (!prevLoc.includes('vista-previa')) {
  console.error('✗ el panel rechazó la vista previa:', prevLoc.split('err=')[1] ?? prevLoc);
  process.exit(1);
}
const conf = await req('/admin/fixture/confirmar', { method: 'POST', body: form({ tournament_id: chosen.id }) });
const loc = decodeURIComponent(conf.headers.get('location') ?? '');
if (loc.includes('err=')) {
  console.error('✗ el panel rechazó la confirmación:', loc.split('err=')[1]);
  process.exit(1);
}
console.log('✓ fixture:', loc.includes('msg=') ? loc.split('msg=')[1] : loc);

// ── verificación: fechas y partidos, y reparto por zona ────────────────────
const fx2 = await (await req(`/admin/fixture?t=${chosen.slug}`)).text();
const fechas = [...fx2.matchAll(/<h3 class="zone-title">Fecha (\d+)/g)].length;
const partidos = (fx2.match(/class="faint">vs</g) ?? []).length;
console.log(`✓ fechas: ${fechas} · partidos en el fixture: ${partidos}`);
console.log(`\nListo. Revisá ${BASE}/fixture?t=${chosen.slug}`);
