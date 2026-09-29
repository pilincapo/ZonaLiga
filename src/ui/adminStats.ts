// Páginas nuevas del panel (arquitectura de navegación 0.2.51):
// - Delegados: vista consolidada de los códigos de acceso por club.
// - Estadísticas: tabla, goleadores/tarjetas, fair play y valla del torneo.
// No agregan lógica de negocio: reutilizan consultas y cálculos existentes.

import { esc, escUrl } from '../lib/html.ts';
import type { Match, Team, Tournament } from '../lib/types.ts';
import { computeStandings, computeFairPlay, computeValla, groupBy, FAIR_PLAY } from '../lib/standings.ts';
import { matchesForStandings } from '../lib/crossover.ts';
import { rulesOf } from '../lib/rules.ts';
import { zonesOf } from '../lib/zones.ts';
import { topCards, topScorers, teamCards, listTeams, listTournaments, type CardsRow, type ScorersRow } from '../lib/queries.ts';
import { pendingForTournament, type PendingSubmissionRow } from '../lib/submissions.ts';
import { loadTournamentView } from '../lib/tournamentView.ts';
import { adminLayout } from './admin.ts';
import { emptyNote, icon } from './components.ts';
import { crest } from './match.ts';

function flash(kind: 'error' | 'success', message: string | undefined): string {
  if (!message) return '';
  return `<div class="${kind === 'error' ? 'error-box' : 'success-box'}">${esc(message)}</div>`;
}

/* ============================== DELEGADOS ============================== */

export async function delegadosAdminPage(
  db: D1Database,
  msg?: string,
  errMsg?: string
): Promise<string> {
  const teamsRows = await listTeams(db, true);
  const pendientes = await pendingSubs(db);
  // Entregas pendientes por equipo (de cualquier torneo activo).
  const pendByTeam = new Map<number, number>();
  for (const p of pendientes) pendByTeam.set(p.team_id, (pendByTeam.get(p.team_id) ?? 0) + 1);

  // Métricas derivadas del mismo estado que muestra la tabla clásica.
  const habilitados = teamsRows.filter((tm) => tm.delegate_enabled === 1 && !!tm.delegate_code).length;
  const sinCodigo = teamsRows.filter((tm) => tm.delegate_enabled === 1 && !tm.delegate_code).length;
  const sinDelegado = teamsRows.length - habilitados - sinCodigo;

  const metric = (label: string, sub: string, value: number, tone: string, ico: string) => `
  <div class="dash-metric ${tone}">
    <span class="dash-metric-ico">${icon(ico as 'users', 18)}</span>
    <span class="dash-metric-tx"><span class="dash-metric-lbl">${esc(label)}</span><span class="dash-metric-num">${value}</span><span class="dash-metric-sub">${esc(sub)}</span></span>
    <span class="dash-metric-bar"><span></span></span>
  </div>`;

  const cards = teamsRows
    .map((tm) => {
      const habilitado = tm.delegate_enabled === 1 && !!tm.delegate_code;
      const estado = habilitado
        ? '<span class="badge green">Habilitado</span>'
        : tm.delegate_enabled === 1
          ? '<span class="badge amber">Sin código</span>'
          : '<span class="badge ghost">Sin delegado</span>';
      const estadoKey = habilitado ? 'ok' : tm.delegate_enabled === 1 ? 'sin-codigo' : 'sin';
      const pend = pendByTeam.get(tm.id) ?? 0;
      const pendCell =
        pend > 0
          ? `<a class="badge amber" href="/admin/entregas" title="Ver entregas pendientes">${pend} pendiente${pend === 1 ? '' : 's'}</a>`
          : '<span class="faint">—</span>';
      const acciones = habilitado
        ? `<form method="post" action="/admin/equipos/${tm.id}/delegado/codigo" style="display:inline"><button class="btn btn-ghost btn-sm" type="submit" title="Genera un código nuevo (el anterior deja de funcionar)">⟳ Código</button></form>
           <form method="post" action="/admin/equipos/${tm.id}/delegado/revocar" style="display:inline" onsubmit="return confirm('¿Revocar el acceso del delegado de ${esc(tm.name)}?')"><button class="tcard-ghost" type="submit" title="Revocar acceso">✕</button></form>`
        : `<form method="post" action="/admin/equipos/${tm.id}/delegado" style="display:inline"><input type="hidden" name="delegate_enabled" value="on"><button class="btn btn-row btn-sm" type="submit" title="Habilita un delegado y genera su código">Habilitar</button></form>`;
      const codigo = habilitado && tm.delegate_code
        ? `<code class="small">${esc(tm.delegate_code)}</code>`
        : '<span class="faint">—</span>';
      const nombre = tm.delegate_enabled === 1 && tm.delegate_name
        ? esc(tm.delegate_name)
        : '<span class="faint">—</span>';
      const buscar = `${tm.name} ${tm.delegate_enabled === 1 ? tm.delegate_name ?? '' : ''}`.toLowerCase();
      return `<article class="tcard pcard ${tm.active ? '' : 'off'}" data-buscar="${esc(buscar)}" data-estado="${estadoKey}">
    <span class="tcard-ico pcrest">${crest(tm, 'sm')}</span>
    <div class="tcard-tx">
      <div class="tcard-top"><a href="/admin/equipos/${escUrl(String(tm.id))}"><strong>${esc(tm.name)}</strong></a>${estado}${tm.active ? '' : ' <span class="badge ghost">inactivo</span>'}</div>
      <div class="tcard-meta">
        <span>Delegado: ${nombre}</span>
        <span>Código: ${codigo}</span>
        ${pendCell}
      </div>
    </div>
    <div class="tcard-acts">${acciones}</div>
  </article>`;
    })
    .join('');

  const body = `
${flash('success', msg)}
${flash('error', errMsg)}
<div class="dash-hero">
  <div class="dash-hero-tx">
    <span class="dash-kicker">Equipos</span>
    <h1>Delegados</h1>
    <p>Códigos de acceso por club: el delegado entra en /delegado con su código y carga el resultado; vos lo aprobás desde Entregas.</p>
  </div>
</div>
<div class="dash-metrics">
  ${metric('Total', 'equipos', teamsRows.length, 'm-blue', 'list')}
  ${metric('Habilitados', 'con código activo', habilitados, 'm-green', 'shield')}
  ${metric('Sin código', 'habilitado a medias', sinCodigo, 'm-amber', 'bell')}
  ${metric('Sin delegado', 'acceso sin abrir', sinDelegado, 'm-violet', 'users')}
</div>
<section class="block"><div class="card" style="padding:14px">
  <div class="tpage-filters">
    <div class="tpage-search">${icon('search', 15)}<input id="tSearch" type="search" placeholder="Buscar por equipo o delegado…" aria-label="Buscar delegado"></div>
    <div class="tpage-tabs" role="group" aria-label="Filtrar por estado">
      <button type="button" class="tpage-tab on" data-estado="">Todos</button>
      <button type="button" class="tpage-tab" data-estado="ok">Habilitados</button>
      <button type="button" class="tpage-tab" data-estado="sin-codigo">Sin código</button>
      <button type="button" class="tpage-tab" data-estado="sin">Sin delegado</button>
    </div>
  </div>
</div></section>
<section class="block"><div class="tpage-list" id="tList">
  ${cards || '<div class="empty-note">Todavía no hay equipos. Crealos desde Equipos.</div>'}
  <div class="empty-note" id="tEmpty" style="display:none">Ningún delegado coincide con el filtro.</div>
</div></section>
<script>
  (function () {
    var list = document.getElementById('tList');
    var input = document.getElementById('tSearch');
    if (!list || !input) return;
    var tabs = [].slice.call(document.querySelectorAll('.tpage-tab'));
    var cards = [].slice.call(list.querySelectorAll('.tcard'));
    var vacio = document.getElementById('tEmpty');
    function sync() {
      var q = (input.value || '').trim().toLowerCase();
      var est = '';
      tabs.forEach(function (b) { if (b.classList.contains('on')) est = b.getAttribute('data-estado') || ''; });
      var visibles = 0;
      cards.forEach(function (c) {
        var ok = (est === '' || c.getAttribute('data-estado') === est) && (!q || (c.getAttribute('data-buscar') || '').indexOf(q) !== -1);
        c.style.display = ok ? '' : 'none';
        if (ok) visibles++;
      });
      if (vacio) vacio.style.display = visibles ? 'none' : '';
    }
    tabs.forEach(function (b) {
      b.addEventListener('click', function () {
        tabs.forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        sync();
      });
    });
    input.addEventListener('input', sync);
  })();
</script>`;
  return adminLayout(db, { title: 'Delegados', active: 'delegados', body });
}

/** Pendientes de todos los torneos (para contar por equipo). */
async function pendingSubs(db: D1Database): Promise<PendingSubmissionRow[]> {
  const tournaments = await listTournaments(db);
  const all = await Promise.all(tournaments.map((t) => pendingForTournament(db, t.id)));
  return all.flat();
}

/* ============================== ESTADÍSTICAS ============================== */

type StatTab = 'tabla' | 'goleadores' | 'fairplay' | 'valla';

const STAT_TABS: { id: StatTab; label: string }[] = [
  { id: 'tabla', label: 'Tabla' },
  { id: 'goleadores', label: 'Goleadores y tarjetas' },
  { id: 'fairplay', label: 'Fair play' },
  { id: 'valla', label: 'Valla menos vencida' },
];

export async function estadisticasAdminPage(
  db: D1Database,
  slugParam: string | undefined,
  tabParam: string | undefined
): Promise<string> {
  const tournaments = await listTournaments(db);
  if (tournaments.length === 0) {
    return adminLayout(db, {
      title: 'Estadísticas',
      active: 'estadisticas',
      body: `<section class="hero" style="padding-bottom:12px"><div class="hero-kicker">Panel</div><h1>Estadísticas</h1></section><div class="card"><div class="card-body">Primero creá un torneo.</div></div>`,
    });
  }
  const view = await loadTournamentView(db, { slug: slugParam });
  if (!view) {
    return adminLayout(db, {
      title: 'Estadísticas',
      active: 'estadisticas',
      body: `<section class="hero" style="padding-bottom:12px"><div class="hero-kicker">Panel</div><h1>Estadísticas</h1></section>${emptyNote('No hay torneo activo')}`,
    });
  }
  const t: Tournament = view.tournament;
  const matches: Match[] = view.matches;
  const teams: Team[] = view.teams;
  const tab: StatTab = STAT_TABS.some((x) => x.id === tabParam) ? (tabParam as StatTab) : 'tabla';
  const rules = rulesOf(t);
  const tabsQ = STAT_TABS.map(
    (x) => `<a class="tpage-tab ${x.id === tab ? 'on' : ''}" href="/admin/estadisticas?t=${escUrl(t.slug)}&tab=${x.id}">${x.label}</a>`
  ).join('');

  const zonas = zonesOf(t.config);
  const zoneOf = new Map<number, string>();
  for (const m of matches) {
    if (m.zone) {
      if (m.home_team_id != null) zoneOf.set(m.home_team_id, m.zone);
      if (m.away_team_id != null) zoneOf.set(m.away_team_id, m.zone);
    }
  }
  if (zoneOf.size === 0 && zonas.enabled) {
    for (const z of zonas.zones) for (const id of z.teamIds) zoneOf.set(id, z.name);
  }
  const standings = computeStandings(
    matchesForStandings(matches, t.config),
    teams.map((tm) => ({ id: tm.id, name: tm.name })),
    rules
  );

  let content = '';
  if (tab === 'tabla') {
    content = standingsTablesHtml(standings, teams, zoneOf);
  } else if (tab === 'goleadores') {
    const [scorers, cards] = await Promise.all([topScorers(db, t.id, 50), topCards(db, t.id, 50)]);
    content = scorersHtml(scorers) + cardsHtml(cards);
  } else if (tab === 'fairplay' || tab === 'valla') {
    if (!rules.showAdvanced) {
      content = emptyNote('La regla de fair play está desactivada para este torneo (Torneos → reglas avanzadas).');
    } else {
      const cards = await teamCards(db, t.id);
      const teamRows = teams.map((tm) => ({ id: tm.id, name: tm.name }));
      if (tab === 'fairplay') {
        const fp = computeFairPlay(
          cards.map((c) => ({ teamId: c.team_id, type: c.type })),
          teamRows
        );
        content = fairPlayHtml(fp, teams);
      } else {
        const valla = computeValla(standings, teamRows);
        content = vallaHtml(valla, teams);
      }
    }
  }

  const teamPickOptions = tournaments
    .map((x) => `<option value="${escUrl(x.slug)}" ${x.id === t.id ? 'selected' : ''}>${esc(x.name)}</option>`)
    .join('');
  const body = `
<div class="dash-hero">
  <div class="dash-hero-tx">
    <span class="dash-kicker">Panel</span>
    <h1>Estadísticas</h1>
    <p>Tabla, goleadores, tarjetas y premios del torneo: mismos números que el sitio público.</p>
  </div>
  <form method="get" action="/admin/estadisticas" class="pselect">
    <input type="hidden" name="tab" value="${tab}">
    <label for="stPick">Torneo</label>
    <div class="tpage-search pselect-box">${icon('trophy', 15)}<select id="stPick" name="t" onchange="this.form.submit()">${teamPickOptions}</select></div>
  </form>
</div>
<div class="tpage-tabs stabs">${tabsQ}</div>
${content}`;
  return adminLayout(db, { title: 'Estadísticas', active: 'estadisticas', body });
}

/** Tabla de posiciones por zona: mismo formato que la página pública. */
function standingsTablesHtml(
  standings: ReturnType<typeof computeStandings>,
  teams: Team[],
  zoneOf: Map<number, string>
): string {
  const nameOf = (id: number) => teams.find((tm) => tm.id === id)?.name ?? `#${id}`;
  const zonas = groupBy(
    standings.map((r) => ({ row: r, zone: zoneOf.get(r.teamId) ?? '' })),
    (x) => x.zone
  );
  const tables = [...zonas.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([zone, rows]) => {
      const title = zone ? `Zona ${zone}` : zonas.size > 1 ? 'General' : '';
      const body = rows
        .map(
          ({ row: r }, i) => `<tr>
      <td class="pos-num">${i + 1}</td>
      <td>${esc(nameOf(r.teamId))}</td>
      <td class="num">${r.played}</td><td class="num">${r.won}</td><td class="num">${r.drawn}</td><td class="num">${r.lost}</td>
      <td class="num">${r.goalsFor}</td><td class="num">${r.goalsAgainst}</td>
      <td class="num">${r.diff > 0 ? '+' + r.diff : r.diff}</td>
      <td class="num"><strong>${r.points}</strong></td>
    </tr>`
        )
        .join('');
      return `${title ? `<h3 class="zone-title">${esc(title)}</h3>` : ''}
  <div class="dash-card"><div class="table-wrap"><table class="data standings">
    <thead><tr><th></th><th>Equipo</th><th class="num">PJ</th><th class="num">G</th><th class="num">E</th><th class="num">P</th><th class="num">GF</th><th class="num">GC</th><th class="num">DIF</th><th class="num">PTS</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div></div>`;
    })
    .join('');
  return tables || emptyNote('El torneo todavía no tiene fixture.');
}

function scorersHtml(scorers: ScorersRow[]): string {
  const rows = scorers
    .map(
      (s, i) => `<tr>
    <td class="pos-num">${i + 1}</td>
    <td>${esc(s.player_name)}</td>
    <td>${esc(s.team_name)}</td>
    <td class="num"><strong>${s.goals}</strong></td>
  </tr>`
    )
    .join('');
  return `<h3 class="zone-title">Goleadores</h3>
<div class="dash-card"><div class="table-wrap"><table class="data">
  <thead><tr><th></th><th>Jugador</th><th>Equipo</th><th class="num">Goles</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="4" class="empty-note">Sin goles registrados todavía</td></tr>'}</tbody>
</table></div></div>`;
}

function cardsHtml(cards: CardsRow[]): string {
  const rows = cards
    .map(
      (c) => `<tr>
    <td></td>
    <td>${esc(c.player_name)}</td>
    <td>${esc(c.team_name)}</td>
    <td class="num">${c.yellows}</td>
    <td class="num">${c.reds}</td>
  </tr>`
    )
    .join('');
  return `<h3 class="zone-title">Tarjetas</h3>
<div class="dash-card"><div class="table-wrap"><table class="data">
  <thead><tr><th></th><th>Jugador</th><th>Equipo</th><th class="num">🟨</th><th class="num">🟥</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="5" class="empty-note">Sin tarjetas registradas</td></tr>'}</tbody>
</table></div></div>`;
}

function fairPlayHtml(fp: ReturnType<typeof computeFairPlay>, teams: Team[]): string {
  const nameOf = (id: number) => teams.find((tm) => tm.id === id)?.name ?? `#${id}`;
  const rows = fp
    .map(
      (r) => `<tr>
    <td>${esc(nameOf(r.teamId))}</td>
    <td class="num">${r.yellows}</td>
    <td class="num">${r.reds}</td>
    <td class="num"><strong>${r.points}</strong></td>
  </tr>`
    )
    .join('');
  return `<h3 class="zone-title">Fair play (amarilla ${FAIR_PLAY.yellow}, roja ${FAIR_PLAY.red} — gana el que menos tiene)</h3>
<div class="dash-card"><div class="table-wrap"><table class="data">
  <thead><tr><th>Equipo</th><th class="num">🟨</th><th class="num">🟥</th><th class="num">Pts</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="4" class="empty-note">Sin tarjetas registradas</td></tr>'}</tbody>
</table></div></div>`;
}

function vallaHtml(valla: ReturnType<typeof computeValla>, teams: Team[]): string {
  const nameOf = (id: number) => teams.find((tm) => tm.id === id)?.name ?? `#${id}`;
  const rows = valla
    .map(
      (r) => `<tr>
    <td>${esc(nameOf(r.teamId))}</td>
    <td class="num"><strong>${r.gc}</strong></td>
  </tr>`
    )
    .join('');
  return `<h3 class="zone-title">Valla menos vencida</h3>
<div class="dash-card"><div class="table-wrap"><table class="data">
  <thead><tr><th>Equipo</th><th class="num">GC</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="3" class="empty-note">Sin partidos jugados todavía</td></tr>'}</tbody>
</table></div></div>`;
}
