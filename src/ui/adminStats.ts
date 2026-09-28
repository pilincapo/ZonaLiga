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
import { emptyNote } from './components.ts';

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

  const rows = teamsRows
    .map((tm) => {
      const habilitado = tm.delegate_enabled === 1 && !!tm.delegate_code;
      const estado = habilitado
        ? `<span class="badge green">Habilitado</span>`
        : tm.delegate_enabled === 1
          ? `<span class="badge amber">Sin código</span>`
          : `<span class="badge ghost">Sin delegado</span>`;
      const pend = pendByTeam.get(tm.id) ?? 0;
      const pendCell =
        pend > 0
          ? `<a class="badge amber" href="/admin/entregas" title="Ver entregas pendientes">${pend} pendiente${pend === 1 ? '' : 's'}</a>`
          : '<span class="faint">—</span>';
      const acciones = habilitado
        ? `<form method="post" action="/admin/equipos/${tm.id}/delegado/codigo" style="display:inline"><button class="btn btn-ghost btn-sm" type="submit" title="Genera un código nuevo (el anterior deja de funcionar)">⟳ Código</button></form>
           <form method="post" action="/admin/equipos/${tm.id}/delegado/revocar" style="display:inline" onsubmit="return confirm('¿Revocar el acceso del delegado de ${esc(tm.name)}?')"><button class="btn btn-ghost btn-sm" type="submit">✕ Revocar</button></form>`
        : `<form method="post" action="/admin/equipos/${tm.id}/delegado" style="display:inline"><input type="hidden" name="delegate_enabled" value="on"><button class="btn btn-row btn-sm" type="submit" title="Habilita un delegado y genera su código">Habilitar</button></form>`;
      const codigo = habilitado && tm.delegate_code
        ? `<code class="small">${esc(tm.delegate_code)}</code>`
        : '<span class="faint">—</span>';
      const nombre = tm.delegate_enabled === 1 && tm.delegate_name
        ? esc(tm.delegate_name)
        : '<span class="faint">—</span>';
      return `<tr>
  <td><a href="/admin/equipos/${escUrl(String(tm.id))}">${esc(tm.name)}</a>${tm.active ? '' : ' <span class="badge ghost">inactivo</span>'}</td>
  <td>${nombre}</td>
  <td>${estado}</td>
  <td>${codigo}</td>
  <td>${pendCell}</td>
  <td class="actions-cell">${acciones}</td>
</tr>`;
    })
    .join('');

  const body = `
${flash('success', msg)}
${flash('error', errMsg)}
<section class="hero" style="padding-bottom:12px">
  <div class="row-between">
    <div>
      <div class="hero-kicker">Equipos</div>
      <h1>Delegados</h1>
      <p class="hero-sub">Códigos de acceso por club. El delegado entra en /delegado con su código y carga el resultado; vos lo aprobás desde Entregas.</p>
    </div>
  </div>
</section>
<section class="block"><div class="card"><div class="table-wrap"><table class="data">
  <thead><tr><th>Equipo</th><th>Delegado</th><th>Estado</th><th>Código</th><th class="num">Entregas</th><th></th></tr></thead>
  <tbody>${rows || '<tr><td colspan="6" class="empty-note">Todavía no hay equipos. Crealos desde Equipos.</td></tr>'}</tbody>
</table></div></div></section>`;
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
    (x) => `<a class="btn ${x.id === tab ? 'btn-primary' : 'btn-ghost'} btn-sm" href="/admin/estadisticas?t=${escUrl(t.slug)}&tab=${x.id}">${x.label}</a>`
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

  const body = `
<section class="hero" style="padding-bottom:12px">
  <div class="row-between">
    <div>
      <div class="hero-kicker">${esc(t.name)}</div>
      <h1>Estadísticas</h1>
    </div>
  </div>
  <div class="fx-nav">${tabsQ}</div>
</section>
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
  <div class="card"><div class="table-wrap"><table class="data standings">
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
<div class="card"><div class="table-wrap"><table class="data">
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
<div class="card"><div class="table-wrap"><table class="data">
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
<div class="card"><div class="table-wrap"><table class="data">
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
<div class="card"><div class="table-wrap"><table class="data">
  <thead><tr><th>Equipo</th><th class="num">GC</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="3" class="empty-note">Sin partidos jugados todavía</td></tr>'}</tbody>
</table></div></div>`;
}
