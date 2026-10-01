// Vistas públicas del sitio.

import { esc, escUrl } from '../lib/html.ts';
import { formatDateShort, formatDateLong } from '../lib/format.ts';
import { leagueNow } from '../lib/live.ts';
import { groupBy, computeStandings, computeFairPlay, computeValla, FAIR_PLAY } from '../lib/standings.ts';
import { crossoverRoundsOf, matchesForStandings, isCrossoverMatch } from '../lib/crossover.ts';
import { orderMatchesForDisplay } from '../lib/order.ts';
import { crossoverBadge } from './match.ts';
import { zonesOf } from '../lib/zones.ts';
import {
  computeSuspensions,
  remainingSuspensionMatches,
  type PlayerSuspension,
} from '../lib/suspensions.ts';
import { buildBracketColumns, hasBracket, matchShortLabel, matchWinnerLoser, BRACKET_LABELS } from '../lib/bracket.ts';
import { bracketTies, tieWinnerLoser } from '../lib/playoff.ts';
import {
  absoluteUrl,
  shareTextHome,
  shareTextMatchday,
  shareTextScorers,
  shareTextStandings,
  shareTextMatch,
  waLink,
} from '../lib/share.ts';
import {
  listTournaments,
  getTeamBySlug,
  listPlayers,
  getPlayer,
  getMatch,
  listEvents,
  listTeams,
  topScorers,
  topCards,
  teamCards,
  playerStatsAcrossTournaments,
  tournamentStats,
  type ScorersRow,
} from '../lib/queries.ts';
import { searchPlayers, searchTeams, searchTournaments } from '../lib/search.ts';
import { rulesOf } from '../lib/rules.ts';
import { adjustmentsForTournament } from '../lib/adjustments.ts';
import {
  sanctionsForTournament,
  closeFulfilledSanctions,
  SANCTION_MEASURE_LABELS,
  type SanctionRow,
  type SanctionStatus,
} from '../lib/sanctions.ts';
import {
  combineDiscipline,
  playerEligibility,
  hasHardBlock,
  type DisciplineEntry,
  type PlayerEligibility,
} from '../lib/discipline.ts';
import { sanctionEffectsOf } from '../lib/sanctionEffects.ts';
import { crest, teamCell, matchRow, statusTag, bracketColumn, eventRow, zoneBadge } from './match.ts';
import { disciplineForMatch, teamDisciplineNotice } from './admin.ts';
import { icon } from './icons.ts';
import { listTournamentViews, loadTournamentView, type TournamentView } from '../lib/tournamentView.ts';
import { CHANGELOG, latestEntry, type ChangelogItem } from '../changelog.ts';
import type { Match, Team, Tournament } from '../lib/types.ts';
import { layout, shareBar, emptyNote, type NavItem, type NavGroup } from './components.ts';

export const PUBLIC_NAV: NavItem[] = [
  { href: '/', label: 'Inicio', match: 'home' },
  { href: '/en-vivo', label: 'En vivo', match: 'envivo' },
  { href: '/fixture', label: 'Fixture', match: 'fixture' },
  { href: '/posiciones', label: 'Posiciones', match: 'posiciones' },
  { href: '/equipos', label: 'Equipos', match: 'equipos' },
  { href: '/goleadores', label: 'Estadísticas', match: 'goleadores' },
];

/**
 * Grupo "Más" del menú público: páginas de consulta secundaria. Se renderiza
 * como dropdown en desktop y submenú simple en móvil (mismo mecanismo).
 */
export const PUBLIC_NAV_MAS: NavGroup = {
  label: 'Más',
  items: [
    { href: '/historial', label: 'Historial', match: 'historial' },
    { href: '/suspensiones', label: 'Suspensiones', match: 'suspensiones' },
    { href: '/buscar', label: 'Buscar', match: 'buscar' },
    { href: '/changelog', label: 'Novedades', match: 'changelog' },
  ],
};

const FORMAT_LABELS: Record<string, string> = {
  round_robin: 'Todos contra todos',
  zonas_playoffs: 'Zonas + playoffs',
  copa: 'Copa por eliminación',
};

function sectionHead(title: string, href?: string, linkLabel?: string): string {
  const link =
    href && linkLabel
      ? `<a class="muted small" href="${escUrl(href)}">${esc(linkLabel)} →</a>`
      : '';
  return `<div class="card-head"><h2>${esc(title)}</h2>${link}</div>`;
}

function roundLabel(round: number | null, crossoverRounds?: ReadonlySet<number>): string {
  if (round == null) return 'Partidos';
  return crossoverRounds?.has(round) ? `Fecha ${round} — Cruce entre zonas` : `Fecha ${round}`;
}

/* ============================== HOME ============================== */

export async function homePage(db: D1Database, origin: string, slugParam?: string): Promise<string> {
  const [tournaments, stats, view] = await Promise.all([
    listTournaments(db),
    tournamentStats(db),
    loadTournamentView(db, { slug: slugParam, scorers: 5 }),
  ]);
  const t = view?.tournament ?? null;
  // El torneo se propaga solo si el hincha lo eligió (?t=slug). Si la portada
  // muestra el torneo activo por defecto, los enlaces quedan como siempre.
  const tSlug = slugParam && view ? view.tournament.slug : undefined;
  const torneosInner = tournamentCards(tournaments, stats, t?.slug);
  const body = view
    ? await tournamentHomeBody(view, origin, torneosInner, tSlug)
    : `<section class="block">${torneosInner}</section>\n${await emptyHomeBody(db)}`;
  const inner = `
${heroBand(t)}
${body}
${howToBlock()}`;
  return layout({ title: 'ZonaLiga — Inicio', active: 'home', nav: PUBLIC_NAV, mas: PUBLIC_NAV_MAS, tSlug, body: inner });
}

/** Banda del hero con buscador (sin tarjetitas: lo que ofrece ZonaLiga ya lo cuenta el bloque final). */
function heroBand(t: Tournament | null): string {
  const sub = t
    ? `Seguí en vivo <strong>${esc(t.name)}</strong>${t.season ? ` (temporada ${esc(t.season)})` : ''}:${' '}fixture, resultados, tabla de posiciones y goleadores, siempre al día.`
    : 'Organizá, gestioná y seguí tu liga de fútbol amateur de forma simple y rápida: resultados, fixture, tablas y mucho más.';
  return `<section class="hero-band">
  <div class="hero-main">
    <div class="hero-kicker">Fútbol amateur</div>
    <h1>Tu liga, <span class="hl">en un solo lugar</span></h1>
    <p class="hero-sub">${sub}</p>
    <form class="search-bar" action="/buscar" method="get" role="search">
      <span class="search-icon">${icon('search', 20)}</span>
      <input type="search" name="q" placeholder="Buscar equipo, jugador o torneo…" aria-label="Buscar" required>
      <button class="btn btn-primary" type="submit">Buscar</button>
    </form>
  </div>
</section>`;
}

const TOURNAMENT_BADGE: Record<string, { cls: string; label: string }> = {
  active: { cls: '', label: 'En curso' },
  draft: { cls: 'next', label: 'Próximo' },
  finished: { cls: 'done', label: 'Finalizado' },
};

/** Grilla de torneos con tarjeta ilustrada, estado y totales. */
function tournamentCards(
  list: Tournament[],
  stats: Map<number, { teams: number; matches: number }>,
  currentSlug: string | undefined
): string {
  if (list.length === 0) {
    return `<div class="card"><div class="card-body">
      <p class="muted">Todavía no hay torneos. Entrá al panel de administración para crear el primero.</p>
      <a class="btn btn-primary" href="/admin">Ir al panel</a>
    </div></div>`;
  }
  const cards = list
    .map((t) => {
      const badge = TOURNAMENT_BADGE[t.status] ?? TOURNAMENT_BADGE['draft']!;
      const st = stats.get(t.id) ?? { teams: 0, matches: 0 };
      const isCurrent = t.slug === currentSlug;
      const meta = [
        t.season ? `<div class="row">${icon('calendar', 15)}<span>Temporada ${esc(t.season)}</span></div>` : '',
        `<div class="row">${icon('whistle', 15)}<span>${esc(FORMAT_LABELS[t.format] ?? t.format)}</span></div>`,
        isCurrent ? `<div class="row">${icon('bolt', 15)}<span>Mostrándose en la portada</span></div>` : '',
      ].join('');
      return `<a class="tcard" href="${escUrl('/?t=' + t.slug)}">
  <div class="tcard-img">
    <span class="tcard-badge ${badge.cls}">${badge.label}</span>
    <span class="tcard-crest">${esc(t.name)}</span>
  </div>
  <div class="tcard-body">
    <div class="tcard-title">${esc(t.name)}</div>
    <div class="tcard-meta">${meta}</div>
  </div>
  <div class="tcard-foot">
    <span class="stat">${icon('users', 15)}${st.teams} Equipos</span>
    <span class="stat">${icon('calendar', 15)}${st.matches} Partidos</span>
    <span class="go">›</span>
  </div>
</a>`;
    })
    .join('');
  return `<div class="section-head">
  <div>
    <h2>Torneos</h2>
    <div class="sub">El torneo en curso y el archivo de temporadas anteriores.</div>
  </div>
  <a class="more" href="/historial">Ver todos →</a>
</div>
<div class="tcards">${cards}</div>`;
}

/**
 * Cierre de portada: una línea para quien administra una liga. El detalle
 * de funciones vive en el README y en el panel; la portada no compite con
 * el fixture del hincha.
 */
function howToBlock(): string {
  return `<section class="block howto-mini">
  <div>
    <strong>¿Administrás una liga?</strong>
    <span class="muted"> ZonaLiga arma el fixture, la tabla y los goleadores por vos.</span>
  </div>
  <a class="btn btn-outline btn-sm" href="/admin">Probá el panel →</a>
</section>`;
}

async function emptyHomeBody(db: D1Database): Promise<string> {
  const teams = await listTeams(db);
  if (teams.length === 0) {
    return `<section class="block"><div class="card"><div class="card-body">
      <p class="muted">Todavía no hay datos cargados. Entrá al panel de administración para crear tu torneo, equipos y fixture.</p>
      <a class="btn btn-primary" href="/admin">Panel de administración</a>
    </div></div></section>`;
  }
  return `<section class="block">
  <div class="section-head"><div><h2>Equipos</h2><div class="sub">Los clubes que juegan la liga.</div></div></div>
  <div class="grid-cards">${teams
    .map(
      (tm) =>
        `<a class="team-card" href="/equipos/${escUrl(tm.slug)}">${crest(tm, 'lg')}<span class="meta"><span class="name">${esc(tm.name)}</span><span class="sub">Ver plantilla →</span></span></a>`
    )
    .join('')}</div>
</section>`;
}

/**
 * URL con el torneo de la portada propagado: si el hincha entró con /?t=slug,
 * los enlaces contextuales de las secciones conservan ese torneo. Sin ?t=,
 * el enlace queda como siempre.
 */
function tLink(slug: string | undefined, path: string): string {
  return slug ? `${path}?t=${escUrl(slug)}` : path;
}

async function tournamentHomeBody(view: TournamentView, origin: string, torneosInner = '', tSlug?: string): Promise<string> {
  const t = view.tournament;
  const matches = view.matches;
  const teams = view.teams;
  const scorers = view.scorers;
  const teamMap = new Map(teams.map((tm) => [tm.id, tm]));
  // equipo → zona: para los badges de los cruces entre zonas.
  const zonesHome = zonesOf(t.config);
  const zoneOfTeamHome = new Map<number, string>();
  if (zonesHome.enabled) {
    for (const z of zonesHome.zones) for (const id of z.teamIds) zoneOfTeamHome.set(id, z.name);
  }

  const today = new Date().toISOString().slice(0, 10);
  // Los 5 próximos salen de la PRIMERA fecha pendiente, mezclados con la
  // misma clave estable del fixture: si se cortara por id antes de mezclar,
  // el bloque mostraría solo los de la zona que se generó primero.
  const upcomingAll = matches
    .filter((m) => m.status === 'scheduled' && (!m.played_on || m.played_on >= today))
    .sort((a, b) => (a.played_on || '9999').localeCompare(b.played_on || '9999') || a.id - b.id);
  const firstPendingRound = upcomingAll[0]?.round ?? null;
  const upcoming = orderMatchesForDisplay(
    upcomingAll.filter((m) => m.round === firstPendingRound),
    { tournamentId: t.id, round: firstPendingRound }
  ).slice(0, 5);
  const played = matches
    .filter((m) => m.status === 'played' || m.status === 'walkover')
    .sort((a, b) => (b.played_on || '').localeCompare(a.played_on || '') || b.id - a.id)
    .slice(0, 5);

  const standings = computeStandings(
    matchesForStandings(matches, t.config),
    teams.map((tm) => ({ id: tm.id, name: tm.name })),
    rulesOf(t)
  );
  const topRows = standings.slice(0, 5);

  // Compartir próxima fecha: los partidos se listan con la misma mezcla
  // estable que el fixture (no en orden de zona).
  const nextRound = upcoming.length > 0 ? upcoming[0]!.round : null;
  const roundMatches = nextRound != null ? matches.filter((m) => m.round === nextRound) : [];
  const nextRoundList = orderMatchesForDisplay(
    roundMatches,
    { tournamentId: t.id, round: nextRound }
  );
  const shareLines = nextRoundList.map((m) => {
    const h = m.home_team_id != null ? teamMap.get(m.home_team_id)?.name : 'Por definir';
    const a = m.away_team_id != null ? teamMap.get(m.away_team_id)?.name : 'Por definir';
    const time = m.kickoff_time ? ` ${m.kickoff_time}` : '';
    const venue = m.venue ? ` — ${m.venue}` : '';
    return `• ${h ?? '?'} vs ${a ?? '?'}${time}${venue}`;
  });
  const shareHref = nextRound != null
    ? waLink(shareTextMatchday(t.name, `Fecha ${nextRound}`, roundMatches[0]?.played_on ?? '', shareLines, absoluteUrl('/fixture', origin)))
    : waLink(shareTextHome(t.name, absoluteUrl('/', origin)));

  const upcomingHtml = upcoming.length
    ? orderMatchesForDisplay(
        // Los de la primera fecha van mezclados; el resto sigue por día.
        upcoming.filter((m) => m.round === nextRound),
        { tournamentId: t.id, round: nextRound }
      )
        .concat(upcoming.filter((m) => m.round !== nextRound))
        .map((m) => homeMatchRow(m, teamMap, zoneOfTeamHome))
        .join('')
    : '';
  const playedHtml = played.length
    ? played.map((m) => matchRow(m, teamMap, { zoneOfTeam: zoneOfTeamHome })).join('')
    : '';

  const scorersHtml = scorers.length
    ? scorers
        .map(
          (s, i) => `<div class="match-row">
  <span class="pos-num pod${i < 3 ? String(i + 1) : ''}">${i + 1}</span>
  <span class="team-cell"><a href="/jugador/${s.player_id}">${esc(s.player_name)}</a></span>
  <span class="muted small">${esc(s.team_name)}</span>
  <span class="strong" style="margin-left:auto">${s.goals}</span>
</div>`
        )
        .join('')
    : '';

  // Mini-tabla de posiciones: con zonas, los primeros 3 de CADA una (es lo
  // que le interesa al hincha de un vistazo); sin zonas, los primeros 5.
  const zoneOfStandings = new Map<number, string>();
  for (const m of matches) {
    if (m.zone) {
      if (m.home_team_id != null) zoneOfStandings.set(m.home_team_id, m.zone);
      if (m.away_team_id != null) zoneOfStandings.set(m.away_team_id, m.zone);
    }
  }
  if (zoneOfStandings.size === 0) {
    for (const [id, z] of zoneOfTeamHome) zoneOfStandings.set(id, z);
  }
  const byZone = groupBy(
    standings.map((r) => ({ row: r, zone: zoneOfStandings.get(r.teamId) ?? '' })),
    (x) => x.zone
  );
  const zoneChips = [...byZone.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([zone, rows]) => {
      const top = rows.slice(0, 3);
      if (top.length === 0) return '';
      const items = top
        .map(
          ({ row: r }, i) => `<li><span class="pos-num">${i + 1}</span><a href="/equipos/${escUrl(teamMap.get(r.teamId)?.slug ?? '')}">${esc(teamMap.get(r.teamId)?.name ?? '—')}</a><span class="pts">${r.points}</span></li>`
        )
        .join('');
      const title = zone ? `Zona ${zone}` : byZone.size > 1 ? 'General' : 'Posiciones';
      return `<div class="zone-mini"><h3>${esc(title)}</h3><ol>${items}</ol></div>`;
    })
    .filter(Boolean)
    .join('');
  const tableHtml = zoneChips
    ? `<div class="zone-minis">${zoneChips}</div>`
    : '';

  const playedAll = matches.filter((m) => m.status === 'played' || m.status === 'walkover');
  const goalsAll = playedAll.reduce((acc, m) => acc + m.home_goals + m.away_goals, 0);
  const avg = playedAll.length > 0 ? (goalsAll / playedAll.length).toFixed(1) : '0.0';
  const teamsInFixture = new Set(matches.flatMap((m) => [m.home_team_id, m.away_team_id]).filter((x): x is number => x != null)).size;
  // Tarjetas de estadística de la portada: una por número clave, cada una
  // con su acento (verde/azul/violeta/naranja). La de promedio solo tiene
  // sentido si ya hay partidos jugados.
  const statCards = [
    { cls: 'green', ic: 'users' as const, num: String(teamsInFixture), lbl: `Equipo${teamsInFixture === 1 ? '' : 's'}` },
    { cls: 'blue', ic: 'calendar' as const, num: String(playedAll.length), lbl: `Partido${playedAll.length === 1 ? '' : 's'} jugado${playedAll.length === 1 ? '' : 's'}` },
    { cls: 'violet', ic: 'ball' as const, num: String(goalsAll), lbl: `Gol${goalsAll === 1 ? '' : 'es'}` },
    ...(playedAll.length > 0 ? [{ cls: 'amber', ic: 'whistle' as const, num: avg, lbl: 'Goles por partido' }] : []),
  ]
    .map(
      (s) => `<div class="stat-card st-${s.cls}">
  <span class="stat-ico">${icon(s.ic, 17)}</span>
  <span class="stat-num">${s.num}</span>
  <span class="stat-lbl">${s.lbl}</span>
</div>`
    )
    .join('');

  // Aviso destacado cuando hoy hay partidos: lleva al modo en vivo.
  const todayIso = leagueNow().date;
  const todays = matches.filter((m) => m.played_on === todayIso && m.status !== 'bye');
  const todayBanner =
    todays.length > 0
      ? `<section class="block"><a class="live-banner" href="/en-vivo">
    <span class="live-banner-dot"></span>
    <span class="live-banner-text"><strong>Hoy se juega</strong> · ${todays.length} partido(s)${
          nextRound != null ? ` · Fecha ${nextRound}` : ''
        }</span>
    <span class="live-banner-cta">Seguir en vivo →</span>
  </a></section>`
      : '';

  // Portada limpia: las secciones sin datos todavía no se muestran (los
  // enlaces siguen en el menú). Los números del torneo van en tarjetas.
  const blocks: string[] = [];
  if (todayBanner) blocks.push(todayBanner);
  if (upcomingHtml) {
    blocks.push(`<section class="block">
  <div class="section-head">
    <div>
      <h2>Próxima fecha</h2>
      <div class="sub">${nextRound != null ? `Fecha ${nextRound}` : 'Partidos programados'} · ${esc(t.name)}</div>
    </div>
    <a class="more" href="${escUrl(tLink(tSlug, '/fixture'))}">Ver fixture →</a>
  </div>
  <div class="card">${upcomingHtml}${shareBar([{ label: '📲 Compartir por WhatsApp', href: shareHref }])}</div>
</section>`);
  }
  if (tableHtml) {
    blocks.push(`<section class="block">
  <div class="section-head">
    <div><h2>Posiciones</h2><div class="sub">Los primeros de cada zona.</div></div>
    <a class="more" href="${escUrl(tLink(tSlug, '/posiciones'))}">Tabla completa →</a>
  </div>
  <div class="card"><div class="card-body">${tableHtml}</div></div>
</section>`);
  }
  if (playedHtml) {
    blocks.push(`<section class="block"><div class="card">${sectionHead('Últimos resultados', tLink(tSlug, '/fixture'), 'Ver todos')}${playedHtml}</div></section>`);
  }
  if (scorersHtml) {
    blocks.push(`<section class="block"><div class="card">${sectionHead('Goleadores', tLink(tSlug, '/goleadores'), 'Tabla completa')}${scorersHtml}</div></section>`);
  }
  blocks.push(`<section class="block"><div class="card"><div class="card-body"><div class="stats-grid">${statCards}</div></div></div></section>`);
  if (torneosInner) blocks.push(`<section class="block">${torneosInner}</section>`);
  return blocks.join('\n');
}

/**
 * Fila de partido para la portada: vertical, pensada para que el nombre del
 * equipo nunca se corte. Encima los dos equipos con su badge de zona, abajo
 * la hora y la cancha en línea propia.
 */
function homeMatchRow(m: Match, teamMap: Map<number, Team>, zoneOfTeam: Map<number, string>): string {
  const home = m.home_team_id != null ? teamMap.get(m.home_team_id) : undefined;
  const away = m.away_team_id != null ? teamMap.get(m.away_team_id) : undefined;
  const zonaHome = m.zone || zoneOfTeam.get(m.home_team_id ?? -1) || '';
  const zonaAway = m.zone || zoneOfTeam.get(m.away_team_id ?? -1) || '';
  const cruce = isCrossoverMatch(m) ? crossoverBadge() : '';
  const when = [
    m.kickoff_time ? `<span>${icon('clock', 14)} ${esc(m.kickoff_time)}</span>` : '',
    m.played_on ? `<span>${icon('calendar', 14)} ${esc(formatDateShort(m.played_on))}</span>` : '',
    m.venue ? `<span>${icon('pin', 14)} ${esc(m.venue)}</span>` : '',
  ]
    .filter(Boolean)
    .join('');
  return `<div class="home-match">
  <div class="hm-teams">
    <span class="hm-team">${crest(home)}<a href="/equipos/${escUrl(home?.slug ?? '')}">${esc(home?.name ?? 'Por definir')}</a>${zoneBadge(zonaHome, 'left')}</span>
    <span class="hm-vs">vs</span>
    <span class="hm-team">${crest(away)}<a href="/equipos/${escUrl(away?.slug ?? '')}">${esc(away?.name ?? 'Por definir')}</a>${zoneBadge(zonaAway, 'left')}</span>
  </div>
  <div class="hm-when">${cruce}${when}</div>
</div>`;
}

/* ============================== POSICIONES ============================== */

export async function standingsPage(db: D1Database, slugParam?: string, origin = ''): Promise<string> {
  const view = await loadTournamentView(db, { slug: slugParam });
  if (!view) return layout({ title: 'Posiciones', active: 'posiciones', nav: PUBLIC_NAV, mas: PUBLIC_NAV_MAS, body: emptyNote('No hay torneo activo') });
  const t = view.tournament;
  const matches = view.matches;
  const teams = view.teams;
  const teamMap = new Map(teams.map((tm) => [tm.id, tm]));
  const rules = rulesOf(t);
  const teamRows = teams.map((tm) => ({ id: tm.id, name: tm.name }));
  // Los cruces marcados como "no cuentan" se excluyen de la tabla.
  // Las sanciones de equipo con pérdida de puntos entran como ajustes
  // (restan antes de ordenar); los expulsados se marcan al pie de la tabla.
  const teamDiscipline = await sanctionsForTournament(db, t.id);
  const teamFx = sanctionEffectsOf(
    combineDiscipline([], teamDiscipline.map((s) => ({ sanction: s, incidentRound: null, playedRounds: [], today: leagueNow().date }))).active
  );
  const standings = computeStandings(matchesForStandings(matches, t.config), teamRows, rules, teamFx.adjustments);

  // Fair play y valla menos vencida (columna y líderes, según la regla).
  const showAdv = rules.showAdvanced;
  const cards = showAdv ? await teamCards(db, t.id) : [];
  const fairPlay = showAdv
    ? computeFairPlay(
        cards.map((c) => ({ teamId: c.team_id, type: c.type })),
        teamRows
      )
    : [];
  const valla = showAdv ? computeValla(standings, teamRows) : [];
  const fpByTeam = new Map(fairPlay.map((r) => [r.teamId, r]));
  const nameOf = (id: number) => teamMap.get(id)?.name ?? '';

  // Agrupar por zona usando el zone de los partidos. Si todavía no hay
  // fixture (sin partidos que marquen zona), usa la asignación de zonas de la
  // configuración del torneo — así las tablas se ven divididas desde el día 1.
  const zoneOf = new Map<number, string>();
  for (const m of matches) {
    if (m.zone) {
      if (m.home_team_id != null) zoneOf.set(m.home_team_id, m.zone);
      if (m.away_team_id != null) zoneOf.set(m.away_team_id, m.zone);
    }
  }
  if (zoneOf.size === 0) {
    const zc = zonesOf(t.config);
    if (zc.enabled) for (const z of zc.zones) for (const id of z.teamIds) zoneOf.set(id, z.name);
  }
  const zones = groupBy(
    standings.map((r) => ({ row: r, zone: zoneOf.get(r.teamId) ?? '' })),
    (x) => x.zone
  );

  const tables = [...zones.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([zone, rows]) => {
      // Si hay una sola tabla sin zonas, el título repetiría el H1 de la página.
      const title = zone ? `Zona ${zone}` : zones.size > 1 ? 'Posiciones' : '';
      const body = rows
        .map(({ row: r }, i) => {
          const tm = teamMap.get(r.teamId);
          const fp = fpByTeam.get(r.teamId);
          // Sanción de equipo: expulsado se marca en la fila; los puntos ya
          // vienen restados por los ajustes de sanciones (computeStandings).
          const expelledMark = teamFx.expelled.includes(r.teamId)
            ? ' <span class="badge red" title="Expulsado del torneo por sanción disciplinaria">Expulsado</span>'
            : '';
          return `<tr${teamFx.expelled.includes(r.teamId) ? ' style="opacity:.55"' : ''}>
      <td class="pos-num">${i + 1}</td>
      <td>${teamCell(tm)}${expelledMark}</td>
      <td class="num">${r.played}</td><td class="num">${r.won}</td><td class="num">${r.drawn}</td><td class="num">${r.lost}</td>
      <td class="num">${r.goalsFor}</td><td class="num">${r.goalsAgainst}</td>
      <td class="num">${r.diff > 0 ? '+' + r.diff : r.diff}</td>
      <td class="num"><strong>${r.points}</strong></td>
      ${showAdv ? `<td class="num" title="${fp ? `${fp.yellows} amarilla(s), ${fp.reds} roja(s)` : 'Sin tarjetas'}">${fp?.points ?? 0}</td>` : ''}
    </tr>`;
        })
        .join('');
      return `${title ? `<h3 class="zone-title">${esc(title)}</h3>` : ''}
  <div class="card"><div class="table-wrap"><table class="data standings">
    <thead><tr><th></th><th>Equipo</th><th class="num">PJ</th><th class="num">G</th><th class="num">E</th><th class="num">P</th><th class="num">GF</th><th class="num">GC</th><th class="num">DIF</th><th class="num">PTS</th>${showAdv ? '<th class="num" title="Fair play: amarilla 1, roja 3 — gana el que menos tiene">FP</th>' : ''}</tr></thead>
    <tbody>${body}</tbody>
  </table></div></div>`;
    })
    .join('');  const adjustments = await adjustmentsForTournament(db, t.id);
  const adjustmentsNote = adjustments.length
    ? `<section class="block"><div class="card"><div class="card-body">
  <strong class="uppercase">Ajustes de puntos</strong>
  <ul class="hint" style="margin:8px 0 0 18px">${adjustments
    .map(
      (a) =>
        `<li>${esc(a.team_name)}: <strong>${a.delta > 0 ? '+' : ''}${a.delta}</strong> pt(s) — ${esc(a.reason)} ${a.created_at ? ` <span class="faint">(${formatDateShort(a.created_at.slice(0, 10))})</span>` : ''}</li>`
    )
    .join('')}</ul>
</div></div></section>`
    : '';

  // Líderes de fair play y valla menos vencida (solo con datos).
  const leaders =
    showAdv && (cards.length > 0 || valla.length > 0)
      ? `<section class="block"><div class="card"><div class="card-body">
  ${valla.length ? `<p style="margin:0 0 6px"><strong>Valla menos vencida:</strong> ${esc(nameOf(valla[0]!.teamId))} <span class="faint">(${valla[0]!.gc} goles en contra)</span></p>` : ''}
  ${cards.length && fairPlay.length ? `<p style="margin:0"><strong>Fair Play:</strong> ${esc(nameOf(fairPlay[0]!.teamId))} <span class="faint">(${fairPlay[0]!.points} pts — amarilla ${FAIR_PLAY.yellow}, roja ${FAIR_PLAY.red})</span></p>` : ''}
</div></div></section>`
      : '';

  // Compartir tabla: con zonas manda el top 3 de cada una; sin zonas, el top 5.
  const standingsLines =
    zones.size > 1
      ? [...zones.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([zone, rows]) => {
            const top = rows
              .slice(0, 3)
              .map(({ row: r }, i) => `${i + 1}º ${nameOf(r.teamId)} (${r.points})`)
              .join(', ');
            return `• Zona ${zone}: ${top}`;
          })
      : standings.slice(0, 5).map((r, i) => `• ${i + 1}º ${nameOf(r.teamId)} (${r.points} pts)`);
  const standingsShare = shareBar([
    {
      label: '📲 Compartir tabla',
      href: waLink(shareTextStandings(t.name, standingsLines, absoluteUrl('/posiciones', origin))),
    },
  ]);

  const body = `
<section class="hero"><div class="hero-kicker">${esc(t.name)}</div><h1>Posiciones</h1></section>
${tables || emptyNote('Sin datos todavía')}
${standingsShare}
${leaders}
${adjustmentsNote}`;
  return layout({ title: `Posiciones — ${t.name}`, active: 'posiciones', nav: PUBLIC_NAV, mas: PUBLIC_NAV_MAS, tSlug: t.slug, body });
}

/* ============================== FIXTURE ============================== */

/**
 * Índice de página (0-based) que pide /fixture?f=N para compartir el link de
 * una fecha. Devuelve -1 si el parámetro no señala ninguna fecha (vacío, no
 * numérico o menor a 1) y en ese caso se usa la lógica de "próxima fecha".
 * Si N apunta a una fecha inexistente, cae a la más cercana (f=99 con 13
 * fechas muestra la última).
 */
export function fxPageIndexFromUrl(raw: string | undefined, roundKeys: readonly string[]): number {
  if (!raw) return -1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return -1;
  const numKeys = roundKeys.map(Number).filter(Number.isInteger).sort((a, b) => a - b);
  if (numKeys.length === 0) return -1;
  const target = Math.min(Math.max(n, numKeys[0]!), numKeys[numKeys.length - 1]!);
  return roundKeys.indexOf(String(target));
}

export async function fixturePage(db: D1Database, slugParam?: string, roundParam?: string, origin = ''): Promise<string> {
  const view = await loadTournamentView(db, { slug: slugParam });
  if (!view) return layout({ title: 'Fixture', active: 'fixture', nav: PUBLIC_NAV, mas: PUBLIC_NAV_MAS, body: emptyNote('No hay torneo activo') });
  const t = view.tournament;
  const matches = view.matches;
  const teams = view.teams;
  const teamMap = new Map(teams.map((tm) => [tm.id, tm]));

  const rounds = groupBy(matches, (m) => (m.round != null ? String(m.round) : 'x'));
  const roundKeys = [...rounds.keys()].sort((a, b) => Number(a) - Number(b));
  const crossoverRounds = crossoverRoundsOf(t.config);
  // equipo → zona: los cruces entre zonas no llevan zona en el partido
  // (cada equipo es de una distinta); el badge de zona sale de acá.
  const zonesCfg = zonesOf(t.config);
  const zoneOfTeam = new Map<number, string>();
  if (zonesCfg.enabled) {
    for (const z of zonesCfg.zones) for (const id of z.teamIds) zoneOfTeam.set(id, z.name);
  }

  const fxPages: { label: string; day: string; html: string; upcoming: boolean; round: string; lines: string[]; share: string }[] = [];
  const fIdx = fxPageIndexFromUrl(roundParam, roundKeys);
  let defaultIdx = 0;
  for (const key of roundKeys) {
    const rawList = rounds.get(key)!;
    // Orden cronológico por cancha y hora: la lista se lee como el
    // cronograma real del día (la cancha y la hora ya se sortearon al
    // generar, así que el orden no hereda el de las zonas).
    const list = orderMatchesForDisplay(rawList, {
      tournamentId: t.id,
      round: key === 'x' ? null : Number(key),
      mode: 'crono',
    });
    const label = key === 'x' ? 'Sin fecha asignada' : roundLabel(Number(key), crossoverRounds);
    const day = list.find((m) => m.played_on)?.played_on ?? '';
    const upcoming = list.some((m) => m.status === 'scheduled');
    if (fIdx >= 0) {
      // El link trae ?f=N: se muestra esa fecha, sin importar si está jugada.
      defaultIdx = fIdx;
    } else if (upcoming && fxPages.every((p) => !p.upcoming)) {
      // Sin ?f: por defecto se muestra la PRIMERA fecha con partidos pendientes.
      defaultIdx = fxPages.length;
    }
    // Texto para el botón Compartir: lista de partidos + link ?f=N de esta
    // fecha. Va en un data-attr JSON; el script lo une con la URL del día.
    const shareLines = list.map((m) => {
      const h = m.home_team_id != null ? teamMap.get(m.home_team_id)?.name : 'Por definir';
      const a = m.away_team_id != null ? teamMap.get(m.away_team_id)?.name : 'Por definir';
      const time = m.kickoff_time ? ` ${m.kickoff_time}` : '';
      return `• ${h ?? '?'} vs ${a ?? '?'}${time}`;
    });
    fxPages.push({
      label,
      day,
      upcoming,
      round: key === 'x' ? '' : key,
      lines: shareLines,
      share: JSON.stringify({ label, day, lines: shareLines }),
      html: `<div class="card">${list.map((m) => matchRow(m, teamMap, { zoneOfTeam })).join('')}</div>`,
    });
  }

  // Link de compartir inicial (funciona sin JavaScript): la fecha por defecto.
  const p0 = fxPages[defaultIdx] ?? fxPages[0];
  const shareHref0 = p0
    ? waLink(
        shareTextMatchday(
          t.name,
          p0.label,
          p0.day,
          p0.lines,
          absoluteUrl(p0.round ? `/fixture?f=${p0.round}` : '/fixture', origin)
        )
      )
    : '';

  // Navegación de fechas: ‹ › + selector de salto. Sin JS, se ven todas
  // (progressive enhancement: el atributo hidden lo aplica el script).
  const fxNav = `
<div class="fx-nav">
  <button class="btn btn-ghost btn-sm" type="button" id="fxPrev" aria-label="Fecha anterior">‹</button>
  <div class="fx-current"><strong id="fxLabel"></strong><span class="muted small" id="fxDay"></span></div>
  <button class="btn btn-ghost btn-sm" type="button" id="fxNext" aria-label="Fecha siguiente">›</button>
  <select id="fxJump" aria-label="Ir a fecha">${fxPages
    .map((p, i) => `<option value="${i}">${esc(p.label)}</option>`)
    .join('')}</select>
  <a href="#" id="fxAll" class="muted small">Ver todas</a>
  <a href="${escUrl(shareHref0)}" id="fxShare" class="btn btn-ghost btn-sm" target="_blank" rel="noopener" aria-label="Compartir esta fecha por WhatsApp">📲 Compartir</a>
</div>`;
  const fxPagesHtml = fxPages
    .map(
      (p, i) =>
        `<section class="fx-page" data-round="${esc(p.round)}" data-day="${esc(p.day)}" data-share="${escUrl(p.share)}"${i === defaultIdx ? '' : ' hidden'}><h3 class="zone-title">${esc(p.label)}</h3>${p.html}</section>`
    )
    .join('');
  const fxScript = `
<script>
(function () {
  var pages = [].slice.call(document.querySelectorAll('.fx-page'));
  if (!pages.length) return;
  var label = document.getElementById('fxLabel');
  var day = document.getElementById('fxDay');
  var jump = document.getElementById('fxJump');
  var all = document.getElementById('fxAll');
  var share = document.getElementById('fxShare');
  // Texto para WhatsApp: torneo + fecha + partidos + link ?f=N compartible.
  var TITULO = document.querySelector('.hero-kicker');
  function shareHref(p) {
    var d;
    try { d = JSON.parse(p.getAttribute('data-share')); } catch (e) { return '/fixture'; }
    var r = p.getAttribute('data-round');
    var url = location.origin + '/fixture' + (r ? '?f=' + r : '');
    var txt = '\u26BD ' + (TITULO ? TITULO.textContent + ' \u2014 ' : '') + d.label;
    if (d.day) txt += ' (' + fmtDia(d.day) + ')';
    if (d.lines.length) txt += '\\n' + d.lines.join('\\n');
    txt += '\\n\uD83D\uDD17 ' + url;
    return 'https://wa.me/?text=' + encodeURIComponent(txt);
  }
  var DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function fmtDia(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    return DIAS[d.getDay()] + ' ' + d.getDate() + ' ' + MESES[d.getMonth()];
  }
  var cur = pages.findIndex(function (p) { return !p.hidden; });
  if (cur < 0) cur = 0;
  // La URL acompaña a la fecha visible: /fixture?f=3 se puede compartir.
  function setUrl(i) {
    var r = pages[i].getAttribute('data-round');
    try { history.replaceState(null, '', r ? '/fixture?f=' + r : '/fixture'); } catch (e) {}
  }
  function show(i) {
    cur = (i + pages.length) % pages.length;
    pages.forEach(function (p, k) { p.hidden = k !== cur; });
    var p = pages[cur];
    label.textContent = p.querySelector('.zone-title').textContent;
    day.textContent = fmtDia(p.getAttribute('data-day'));
    if (jump) jump.value = String(cur);
    if (all) all.textContent = 'Ver todas';
    if (share) share.href = shareHref(p);
    setUrl(cur);
  }
  document.getElementById('fxPrev').addEventListener('click', function () { show(cur - 1); });
  document.getElementById('fxNext').addEventListener('click', function () { show(cur + 1); });
  if (share) share.addEventListener('click', function () { share.href = shareHref(pages[cur]); });
  if (jump) jump.addEventListener('change', function () { show(Number(jump.value)); });
  if (all) all.addEventListener('click', function (e) {
    e.preventDefault();
    if (pages.some(function (p) { return p.hidden; })) {
      pages.forEach(function (p) { p.hidden = false; });
      label.textContent = 'Todas las fechas';
      day.textContent = pages.length + ' fechas';
      all.textContent = 'Ver una';
      try { history.replaceState(null, '', '/fixture'); } catch (e) {}
    } else {
      show(cur);
    }
  });
  show(cur);
})();
</script>`;

  // Bracket
  let bracketHtml = '';
  if (hasBracket(matches)) {
    const cols = buildBracketColumns(matches);
    bracketHtml = `<section class="block"><div class="card">${sectionHead('Llaves / Playoffs')}
      <div class="bracket">${cols.map((c) => bracketColumn(c, teamMap)).join('')}</div>
    </div></section>`;
  }

  const body = `
<section class="hero"><div class="hero-kicker">${esc(t.name)}</div><h1>Fixture</h1></section>
${fxPages.length > 0 ? fxNav : ''}
${fxPagesHtml || emptyNote('Fixture sin generar todavía')}
${bracketHtml}
${fxScript}`;
  return layout({ title: `Fixture — ${t.name}`, active: 'fixture', nav: PUBLIC_NAV, mas: PUBLIC_NAV_MAS, tSlug: t.slug, body });
}

/* ============================== GOLEADORES ============================== */

export async function scorersPage(db: D1Database, origin: string, slugParam?: string): Promise<string> {
  const view = await loadTournamentView(db, { slug: slugParam, scorers: 50 });
  if (!view) return layout({ title: 'Goleadores', active: 'goleadores', nav: PUBLIC_NAV, mas: PUBLIC_NAV_MAS, body: emptyNote('No hay torneo activo') });
  const t = view.tournament;

  const [scorers, cards] = await Promise.all([Promise.resolve(view.scorers), topCards(db, t.id, 50)]);
  const shareLines = scorers.slice(0, 10).map((s, i) => `${i + 1}. ${s.player_name} (${s.team_name}) — ${s.goals} goles`);

  const scorersHtml = scorers.length
    ? `<div class="table-wrap"><table class="data scorers">
  <thead><tr><th></th><th>Jugador</th><th>Equipo</th><th class="num">Goles</th></tr></thead>
  <tbody>${scorers
    .map(
      (s: ScorersRow, i) => `<tr>
    <td class="pos-num">${i + 1}</td>
    <td><a href="/jugador/${s.player_id}">${esc(s.player_name)}</a>${s.number != null ? ` <span class="faint small">#${s.number}</span>` : ''}</td>
    <td>${esc(s.team_name)}</td>
    <td class="num"><strong class="goal-n goal-n${i + 1 <= 3 ? String(i + 1) : ''}">${s.goals}</strong></td>
  </tr>`
    )
    .join('')}</tbody></table></div>${shareBar([{ label: '📲 Compartir tabla', href: waLink(shareTextScorers(t.name, shareLines, absoluteUrl('/goleadores', origin))) }])}`
    : emptyNote('Sin goles registrados todavía');

  const cardsHtml = cards.length
    ? `<div class="table-wrap"><table class="data">
  <thead><tr><th>Jugador</th><th>Equipo</th><th class="num">🟨</th><th class="num">🟥</th></tr></thead>
  <tbody>${cards
    .map(
      (c) => `<tr>
    <td><a href="/jugador/${c.player_id}">${esc(c.player_name)}</a></td>
    <td>${esc(c.team_name)}</td>
    <td class="num">${c.yellows}</td>
    <td class="num">${c.reds}</td>
  </tr>`
    )
    .join('')}</tbody></table></div>`
    : emptyNote('Sin tarjetas registradas');

  const body = `
<section class="hero"><div class="hero-kicker">${esc(t.name)}</div><h1>Goleadores y tarjetas</h1></section>
<section class="block grid-2">
  <div class="card">${sectionHead('Tabla de goleadores')}${scorersHtml}</div>
  <div class="card">${sectionHead('Tarjetas')}${cardsHtml}</div>
</section>`;
  return layout({ title: `Estadísticas — ${t.name}`, active: 'goleadores', nav: PUBLIC_NAV, mas: PUBLIC_NAV_MAS, tSlug: t.slug, body });
}

/* ============================== EQUIPOS ============================== */

export async function teamsPage(db: D1Database): Promise<string> {
  const teams = await listTeams(db);
  const cards = teams.length
    ? teams
        .map(
          (tm) =>
            `<a class="team-card" href="/equipos/${escUrl(tm.slug)}">${crest(tm, 'lg')}<span class="meta"><span class="name">${esc(tm.name)}</span><span class="sub">${esc(tm.short_name)}</span></span></a>`
        )
        .join('')
    : emptyNote('No hay equipos cargados');
  const body = `
<section class="hero"><div class="hero-kicker">ZonaLiga</div><h1>Equipos</h1></section>
<section class="block"><div class="grid-cards">${cards}</div></section>`;
  return layout({ title: 'Equipos', active: 'equipos', nav: PUBLIC_NAV, mas: PUBLIC_NAV_MAS, body });
}

export async function teamPage(db: D1Database, slug: string): Promise<string> {
  const team = await getTeamBySlug(db, slug);
  if (!team) return notFoundPage();

  const [players, views] = await Promise.all([listPlayers(db, team.id), listTournamentViews(db)]);
  const allTeams = views[0]?.teams ?? [];
  const teamMap = new Map<number, Team>(allTeams.map((tm) => [tm.id, tm]));

  // Partidos del equipo en cada torneo
  const sections: string[] = [];
  let statsHtml = '';
  let zonaHero = '';
  for (const { tournament: t, matches: all, teams: viewTeams } of views) {
    const mine = all.filter((m) => m.home_team_id === team.id || m.away_team_id === team.id);
    if (mine.length === 0) continue;
    // Zona del equipo en este torneo: la del primer torneo con partidos es la
    // que se muestra en el héroe (la ficha corresponde al torneo en curso).
    if (!zonaHero) {
      if (mine.some((m) => m.zone)) {
        const conZona = mine.find((m) => m.zone);
        zonaHero = conZona!.zone;
      } else {
        const zc = zonesOf(t.config);
        if (zc.enabled) {
          const z = zc.zones.find((zz) => zz.teamIds.includes(team.id));
          if (z) zonaHero = z.name;
        }
      }
    }
    // Mapa zona por equipo del torneo (para los cruces entre zonas).
    const zc = zonesOf(t.config);
    const zoneOfTeam = new Map<number, string>();
    if (zc.enabled) for (const z of zc.zones) for (const id of z.teamIds) zoneOfTeam.set(id, z.name);
    // Tira de estadísticas del equipo en su torneo (una sola vez, el más
    // reciente): posición verde, partidos azul, goles violeta, valla naranja.
    if (!statsHtml) {
      const standingsEquipo = computeStandings(
        matchesForStandings(all, t.config),
        viewTeams.map((tm) => ({ id: tm.id, name: tm.name })),
        rulesOf(t)
      );
      // La posición se cuenta DENTRO de su zona/grupo (no en la tabla global):
      // es lo que le importa al hincha. Sin zonas, la tabla es el grupo entero.
      const zonaDelEquipo = zoneOfTeam.get(team.id);
      const tablaDelGrupo = zonaDelEquipo
        ? standingsEquipo.filter((r) => zoneOfTeam.get(r.teamId) === zonaDelEquipo)
        : standingsEquipo;
      const pos = tablaDelGrupo.findIndex((r) => r.teamId === team.id) + 1;
      const playedMine = mine.filter((m) => m.status === 'played' || m.status === 'walkover');
      const gf = playedMine.reduce((acc, m) => acc + (m.home_team_id === team.id ? m.home_goals : m.away_goals), 0);
      const ga = playedMine.reduce((acc, m) => acc + (m.home_team_id === team.id ? m.away_goals : m.home_goals), 0);
      statsHtml = `<div class="card"><div class="card-body"><div class="stats-grid">` +
        `<div class="stat-card st-green"><span class="stat-ico">${icon('trophy', 17)}</span><span class="stat-num">${pos > 0 ? `${pos}°` : '—'}</span><span class="stat-lbl">${zonaDelEquipo ? `Posición · Zona ${esc(zonaDelEquipo)}` : 'Posición'}</span></div>` +
        `<div class="stat-card st-blue"><span class="stat-ico">${icon('calendar', 17)}</span><span class="stat-num">${playedMine.length}</span><span class="stat-lbl">Partidos jugados</span></div>` +
        `<div class="stat-card st-violet"><span class="stat-ico">${icon('ball', 17)}</span><span class="stat-num">${gf}</span><span class="stat-lbl">Goles a favor</span></div>` +
        `<div class="stat-card st-amber" title="Goles en contra de la valla"><span class="stat-ico">${icon('shield', 17)}</span><span class="stat-num">${ga}</span><span class="stat-lbl">Valla</span></div>` +
        `</div></div></div>`;
    }
    sections.push(`<h3 class="zone-title">${esc(t.name)}</h3>
  <div class="card">${mine.map((m) => matchRow(m, teamMap, { zoneOfTeam })).join('')}</div>`);
  }

  const roster = players.length
    ? `<div class="table-wrap"><table class="data">
  <thead><tr><th class="num">#</th><th>Jugador</th><th>Pos</th></tr></thead>
  <tbody>${players
    .map(
      (p) => `<tr>
    <td class="num">${p.number ?? ''}</td>
    <td><a href="/jugador/${p.id}">${esc(p.name)}</a></td>
    <td>${esc(p.position || '—')}</td>
  </tr>`
    )
    .join('')}</tbody></table></div>`
    : emptyNote('Sin plantilla cargada');

  const body = `
<section class="hero">
  <div class="flex" style="gap:16px">
    ${crest(team, 'lg')}
    <div>
      <div class="hero-kicker">Equipo</div>
      <h1>${esc(team.name)}</h1>
      <p class="hero-sub">${esc(team.short_name)}${zonaHero ? ` · Zona ${esc(zonaHero)}` : ''}</p>
    </div>
  </div>
</section>
${statsHtml ? `<section class="block">${statsHtml}</section>` : ''}
<section class="block grid-2">
  <div class="card">${sectionHead('Plantilla')}${roster}</div>
  <div class="card">${sectionHead('Partidos')}${sections.join('') || emptyNote('Sin partidos en torneos')}</div>
</section>`;
  return layout({ title: team.name, active: 'equipos', nav: PUBLIC_NAV, mas: PUBLIC_NAV_MAS, body });
}

/* ============================== JUGADOR ============================== */

export async function playerPage(db: D1Database, id: number): Promise<string> {
  const player = await getPlayer(db, id);
  if (!player) return notFoundPage();
  const [teams, statsByTournament] = await Promise.all([listTeams(db), playerStatsAcrossTournaments(db, player.id)]);
  const myTeam = teams.find((tm) => tm.id === player.team_id) ?? null;

  const perTournament: string[] = [];
  for (const t of await listTournaments(db)) {
    const stats = statsByTournament.get(t.id);
    if (!stats) continue;
    if (stats.goals + stats.ownGoals + stats.yellows + stats.reds + stats.playedMatches === 0) continue;
    perTournament.push(`<div class="card"><div class="card-body row-between">
      <a href="/?t=${escUrl(t.slug)}"><strong>${esc(t.name)}</strong></a>
      <span class="small muted">⚽ ${stats.goals} · 🔁 ${stats.ownGoals} · 🟨 ${stats.yellows} · 🟥 ${stats.reds}</span>
    </div></div>`);
  }

  const body = `
<section class="hero">
  <div class="flex" style="gap:16px">
    <span class="avatar lg">${esc(initials(player.name))}</span>
    <div>
      <div class="hero-kicker">${myTeam ? `<a href="/equipos/${escUrl(myTeam.slug)}">${esc(myTeam.name)}</a>` : 'Jugador'}</div>
      <h1>${esc(player.name)}</h1>
      <p class="hero-sub">${player.number != null ? `#${player.number} · ` : ''}${esc(player.position || '')}</p>
    </div>
  </div>
</section>
<section class="block grid-2">
  <div class="card">${sectionHead('Por torneo')}${perTournament.join('') || emptyNote('Sin estadísticas todavía')}</div>
</section>`;
  return layout({ title: player.name, active: 'equipos', nav: PUBLIC_NAV, mas: PUBLIC_NAV_MAS, body });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? '?';
  const b = parts.length > 1 ? parts[parts.length - 1]![0] : '';
  return (a + b).toUpperCase();
}

/* ============================== PARTIDO (ficha) ============================== */

export async function matchPage(db: D1Database, id: number, origin: string): Promise<string> {
  const m = await getMatch(db, id);
  if (!m) return notFoundPage();
  const [tournament, teams, events] = await Promise.all([
    listTournaments(db).then((ts) => ts.find((t) => t.id === m.tournament_id) ?? null),
    listTeams(db),
    listEvents(db, m.id),
  ]);
  const teamMap = new Map(teams.map((tm) => [tm.id, tm]));
  const home = m.home_team_id != null ? teamMap.get(m.home_team_id) : undefined;
  const away = m.away_team_id != null ? teamMap.get(m.away_team_id) : undefined;

  const players = new Map<number, { name: string; team_id: number }>();
  for (const e of events) {
    if (e.player_id != null && !players.has(e.player_id)) {
      const p = await getPlayer(db, e.player_id);
      if (p) players.set(p.id, { name: p.name, team_id: p.team_id });
    }
  }

  // Elegibilidad para este partido: disciplina combinada (auto + manual),
  // sin recalcular suspensiones. Solo se muestran datos reales existentes.
  const eligibilityInput = await disciplineForMatch(db, m);
  const [homeSquad, awaySquad] = await Promise.all([
    home != null ? listPlayers(db, home.id) : Promise.resolve([]),
    away != null ? listPlayers(db, away.id) : Promise.resolve([]),
  ]);
  const suspended: { name: string; teamName: string; teamId: number | null; reasons: PlayerEligibility['reasons']; hard: boolean }[] = [];
  if (eligibilityInput) {
    for (const p of [...homeSquad, ...awaySquad]) {
      const elig = playerEligibility(eligibilityInput, p.id);
      if (!elig.eligible && elig.reasons.length > 0) {
        const teamName = p.team_id === home?.id ? (home?.name ?? '') : p.team_id === away?.id ? (away?.name ?? '') : '';
        suspended.push({ name: p.name, teamName, teamId: p.team_id, reasons: elig.reasons, hard: hasHardBlock(elig) });
      }
    }
  }
  const teamNotice =
    teamDisciplineNotice(eligibilityInput, m.home_team_id) + teamDisciplineNotice(eligibilityInput, m.away_team_id);
  const suspendedRows = suspended
    .map((s) => {
      const tags = s.reasons
        .map((r) => {
          const origen = r.source === 'auto' ? 'Automática' : 'Manual';
          const rest = r.remaining != null ? ` · ${r.remaining} fecha${r.remaining === 1 ? '' : 's'}` : '';
          const rev = r.needsReview ? ' · a revisar' : '';
          return `<span class="badge ${r.source === 'auto' ? 'ghost' : 'amber'}">${origen}</span> ${esc(r.reason)}${rest}${rev}`;
        })
        .join('<br>');
      const estado = s.hard ? '<span class="badge red">No habilitado</span>' : '<span class="badge amber">Revisar</span>';
      const teamTag = s.teamId != null ? ` <span class="muted small">${esc(s.teamName)}</span>` : '';
      return `<tr><td>${esc(s.name)}${teamTag}</td><td>${tags}</td><td>${estado}</td></tr>`;
    })
    .join('');
  const disciplineBlock =
    eligibilityInput && (teamNotice || suspendedRows)
      ? `<section class="block"><div class="card">${sectionHead('Elegibilidad para este partido')}
        ${teamNotice}
        ${
          suspendedRows
            ? `<div class="table-wrap"><table class="data">
          <thead><tr><th>Jugador</th><th>Motivo</th><th>Estado</th></tr></thead>
          <tbody>${suspendedRows}</tbody></table></div>`
            : emptyNote('Sin jugadores afectados 🎉')
        }
        <p class="hint" style="margin:10px 0 0">Se muestran sanciones vigentes que afectan a este partido. El detalle completo está en <a href="/suspensiones${tournament ? `?t=${escUrl(tournament.slug)}` : ''}">Suspensiones</a>.</p>
      </div></section>`
      : '';

  const homeEvents = events.filter((e) => e.team_id === m.home_team_id);
  const awayEvents = events.filter((e) => e.team_id !== m.home_team_id);
  const evList = (list: typeof events) =>
    list.length ? list.map((e) => eventRow(e, players, teamMap, m)).join('') : emptyNote('—');

  const shareHref = waLink(
    shareTextMatch(home?.name ?? 'Local', away?.name ?? 'Visitante', m.home_goals, m.away_goals, tournament?.name ?? '', absoluteUrl(`/partido/${m.id}`, origin))
  );

  // Badge de cruce entre zonas, igual que en el fixture público.
  const cruceBadge = isCrossoverMatch(m) ? crossoverBadge() : '';

  const scoreLine =
    m.status === 'played' || m.status === 'walkover'
      ? `<div class="flex" style="gap:18px;justify-content:center;font-family:var(--font-head);font-size:clamp(2.2rem,9vw,3.4rem)">
      <span>${m.home_goals}</span><span class="faint">-</span><span>${m.away_goals}</span>
    </div>`
      : `<div class="muted" style="text-align:center">${statusTag(m)}</div>`;

  const roundInfo = [
    m.round != null ? `Fecha ${m.round}` : '',
    m.bracket_round ? (BRACKET_LABELS[m.bracket_round] ?? m.bracket_round) : '',
    m.zone ? `Zona ${m.zone}` : '',
    m.played_on ? formatDateLong(m.played_on) : '',
    m.kickoff_time || '',
    m.venue || '',
  ]
    .filter(Boolean)
    .join(' · ');

  const body = `
<section class="hero" style="padding-bottom:0">
  <div class="hero-kicker">${esc(tournament?.name ?? 'Partido')}${roundInfo ? ' · ' + esc(roundInfo) : ''}</div>
  <div class="grid-2 mt-3">
    <div style="text-align:center">${teamCell(home, { align: 'left' })}</div>
    <div style="text-align:center">${teamCell(away, { align: 'right' })}</div>
  </div>
  <div class="mt-3">${cruceBadge}${scoreLine}</div>
  ${m.notes ? `<p class="muted small mt-2" style="text-align:center">${esc(m.notes)}</p>` : ''}
  ${shareBar([{ label: '📲 Compartir resultado', href: shareHref }])}
</section>
${disciplineBlock}
${
  m.status === 'played' || m.status === 'walkover'
    ? `<section class="block grid-2">
  <div class="card">${sectionHead(esc(home?.name ?? 'Local'))}${evList(homeEvents)}</div>
  <div class="card">${sectionHead(esc(away?.name ?? 'Visitante'))}${evList(awayEvents)}</div>
</section>`
    : ''
}`;
  return layout({ title: `Partido ${m.id}`, active: 'fixture', nav: PUBLIC_NAV, mas: PUBLIC_NAV_MAS, body });
}

/* ============================== HISTORIAL ============================== */

export async function historyPage(db: D1Database): Promise<string> {
  const tournaments = await listTournaments(db);
  if (tournaments.length === 0) {
    return layout({ title: 'Historial', active: 'historial', nav: PUBLIC_NAV, mas: PUBLIC_NAV_MAS, body: emptyNote('Todavía no hay torneos') });
  }

  const cards: string[] = [];
  for (const { tournament: t, matches, teams } of await listTournamentViews(db)) {
    const teamMap = new Map(teams.map((tm) => [tm.id, tm]));
    const played = matches.filter((m) => m.status === 'played' || m.status === 'walkover').length;
    const total = matches.filter((m) => m.status !== 'bye').length;
    // Equipos que realmente figuran en el fixture del torneo (no el total de la liga).
    const teamsCount = new Set(matches.flatMap((m) => [m.home_team_id, m.away_team_id]).filter((x): x is number => x != null)).size;

    let champion = '';
    if (t.status === 'finished') {
      const adjustments = await adjustmentsForTournament(db, t.id);
      const adj = adjustments.reduce((acc, a) => acc + a.delta, 0);
      const standings = computeStandings(
        matchesForStandings(matches, t.config),
        teams.map((tm) => ({ id: tm.id, name: tm.name })),
        rulesOf(t)
      );
      // Si hay llave y la final está decidida, el campeón es el de la final
      // por resultado GLOBAL (con ida y vuelta, goles sumados de ambas).
      const finalTie = bracketTies(matches, 'F')[0];
      const finalWinner = finalTie ? tieWinnerLoser(matches, finalTie) : null;
      const championId = finalWinner?.winner ?? standings[0]?.teamId;
      champion = championId != null ? `<div class="champ-band mt-2">${icon('trophy', 15)}<span><strong>Campeón:</strong> ${esc(teamMap.get(championId)?.name ?? '')}</span></div>` : '';
      if (adj !== 0) {
        champion += `<div class="small" style="color:var(--st-amber);opacity:.8;margin-top:4px">Incluye ${adj > 0 ? '+' : ''}${adj} pt(s) de ajustes manuales</div>`;
      }
    }

    cards.push(`<div class="card">
  <div class="card-head"><h2><a href="/?t=${escUrl(t.slug)}">${esc(t.name)}</a></h2>
    <span class="badge ${t.status === 'finished' ? 'ghost' : t.status === 'active' ? 'green' : 'amber'}">${t.status === 'finished' ? 'Finalizado' : t.status === 'active' ? 'En curso' : 'Borrador'}</span>
  </div>
  <div class="card-body">
    <div class="hist-meta"><span>${icon('whistle', 14)}${esc(t.format === 'round_robin' ? 'Todos contra todos' : t.format === 'zonas_playoffs' ? 'Zonas + playoffs' : 'Copa')}</span><span class="st-green">${icon('users', 14)}${teamsCount} equipo${teamsCount === 1 ? '' : 's'}</span><span class="st-blue">${icon('calendar', 14)}${played}/${total} partido${total === 1 ? '' : 's'}</span></div>
    ${champion}
  </div>
</div>`);
  }

  const body = `
<section class="hero"><div class="hero-kicker">ZonaLiga</div><h1>Historial de torneos</h1></section>
<section class="block grid-2">${cards.join('')}</section>`;
  return layout({ title: 'Historial', active: 'historial', nav: PUBLIC_NAV, mas: PUBLIC_NAV_MAS, body });
}

/* ============================== BUSCAR ============================== */

function searchForm(query: string): string {
  return `<form class="search-bar" action="/buscar" method="get" role="search">
    <span class="search-icon">${icon('search', 20)}</span>
    <input type="search" name="q" value="${esc(query)}" placeholder="Buscar equipo, jugador o torneo…" aria-label="Buscar" required>
    <button class="btn btn-primary" type="submit">Buscar</button>
  </form>`;
}

export async function searchPage(db: D1Database, q?: string): Promise<string> {
  const query = (q ?? '').trim();
  const head = `<section class="hero">
  <div class="hero-kicker">Búsqueda</div>
  <h1>${query ? `Resultados para “${esc(query)}”` : 'Buscar en la liga'}</h1>
  <p class="hero-sub">Encontrá equipos, jugadores y torneos al instante.</p>
  ${searchForm(query)}
</section>`;

  if (!query) {
    return layout({ title: 'Buscar', active: 'buscar', nav: PUBLIC_NAV, mas: PUBLIC_NAV_MAS, body: head });
  }

  const [teams, players, tournaments] = await Promise.all([
    searchTeams(db, query),
    searchPlayers(db, query),
    searchTournaments(db, query),
  ]);
  const total = teams.length + players.length + tournaments.length;

  const tournamentsHtml = tournaments.length
    ? `<section class="block">
  <div class="section-head"><div><h2>Torneos</h2><div class="sub">${tournaments.length} resultado(s)</div></div></div>
  ${tournaments
    .map((t) => {
      const badge = TOURNAMENT_BADGE[t.status] ?? TOURNAMENT_BADGE['draft']!;
      return `<div class="card" style="margin-bottom:10px"><div class="card-body row-between">
    <div><div class="strong">${esc(t.name)}</div><div class="small muted">${esc(FORMAT_LABELS[t.format] ?? t.format)}${t.season ? ` · Temporada ${esc(t.season)}` : ''}</div></div>
    <a class="btn btn-ghost btn-sm" href="${escUrl('/?t=' + t.slug)}">Ver <span class="badge ${t.status === 'active' ? 'green' : 'ghost'}" style="margin-left:6px">${badge.label}</span></a>
  </div></div>`;
    })
    .join('')}
</section>`
    : '';

  const teamsHtml = teams.length
    ? `<section class="block">
  <div class="section-head"><div><h2>Equipos</h2><div class="sub">${teams.length} resultado(s)</div></div></div>
  <div class="grid-cards">${teams
    .map(
      (tm) =>
        `<a class="team-card" href="/equipos/${escUrl(tm.slug)}">${crest(tm, 'lg')}<span class="meta"><span class="name">${esc(tm.name)}</span><span class="sub">Ver plantilla →</span></span></a>`
    )
    .join('')}</div>
</section>`
    : '';

  const playersHtml = players.length
    ? `<section class="block">
  <div class="section-head"><div><h2>Jugadores</h2><div class="sub">${players.length} resultado(s)</div></div></div>
  <div class="card"><div class="table-wrap"><table class="data" style="min-width:0">
    <thead><tr><th>Jugador</th><th>Equipo</th><th class="num">Camiseta</th></tr></thead>
    <tbody>${players
      .map(
        (p) => `<tr>
      <td><a href="/jugador/${p.id}">${esc(p.name)}</a></td>
      <td><a class="small" href="/equipos/${escUrl(p.team_slug)}">${esc(p.team_name)}</a></td>
      <td class="num">${p.number != null ? esc(String(p.number)) : '—'}</td>
    </tr>`
      )
      .join('')}</tbody>
  </table></div></div>
</section>`
    : '';

  const nothing = `<section class="block"><div class="card"><div class="card-body">${emptyNote(
    `No encontramos nada para “${query}”. Probá con el nombre del equipo o de un jugador.`
  )}<div style="text-align:center"><a class="btn btn-ghost btn-sm" href="/equipos">Ver todos los equipos</a></div></div></div></section>`;

  const body = `${head}${total === 0 ? nothing : tournamentsHtml + teamsHtml + playersHtml}`;
  return layout({ title: `Buscar: ${query}`, active: 'buscar', nav: PUBLIC_NAV, mas: PUBLIC_NAV_MAS, body });
}

/* ============================== CHANGELOG ============================== */

const KIND_LABEL: Record<ChangelogItem['kind'], string> = {
  nuevo: 'Nuevo',
  mejora: 'Mejora',
  arreglo: 'Arreglo',
};

/** Página de novedades: en lenguaje sencillo, la más nueva arriba. */
export function changelogPage(): string {
  const entries = CHANGELOG.map((e) => {
    const items = e.items
      .map((i) => `<li><span class="badge ${i.kind === 'nuevo' ? 'green' : i.kind === 'mejora' ? 'info' : 'red'}">${KIND_LABEL[i.kind]}</span>${esc(i.text)}</li>`)
      .join('');
    const fecha = formatDateLong(e.date);
    return `<article class="card changelog-entry">
  <header class="card-head">
    <h2>v${esc(e.version)} — ${esc(e.title)}</h2>
    <span class="badge ghost">${esc(fecha)}</span>
  </header>
  <ul class="changelog-list">${items}</ul>
</article>`;
  }).join('');

  const body = `
<section class="hero">
  <div class="hero-kicker">ZonaLiga v${esc(latestEntry().version)}</div>
  <h1>Novedades</h1>
  <p class="hero-sub">Acá contamos, con palabras simples, todo lo que vamos agregando y mejorando del sitio.</p>
</section>
<section class="block">${entries}</section>`;
  return layout({ title: 'Novedades — ZonaLiga', active: 'changelog', nav: PUBLIC_NAV, mas: PUBLIC_NAV_MAS, body });
}

/* ============================== 404 ============================== */

export function notFoundPage(): string {
  const body = `<section class="hero"><h1>404</h1><p class="hero-sub">No encontramos esta página.</p><a class="btn btn-primary mt-3" href="/">Volver al inicio</a></section>`;
  return layout({ title: 'No encontrado', nav: PUBLIC_NAV, mas: PUBLIC_NAV_MAS, body });
}

/* ============================== Suspensiones (público) ============================== */

function sortEntries(a: DisciplineEntry, b: DisciplineEntry): number {
  if (a.source !== b.source) return a.source === 'auto' ? -1 : 1;
  return (a.playerId ?? 0) - (b.playerId ?? 0);
}

export async function suspensionsPage(db: D1Database, slugParam?: string): Promise<string> {
  const view = await loadTournamentView(db, { slug: slugParam, events: true });
  if (!view) return layout({ title: 'Suspensiones', active: 'suspensiones', nav: PUBLIC_NAV, mas: PUBLIC_NAV_MAS, body: emptyNote('No hay torneo activo') });
  const t = view.tournament;
  const matches = view.matches;
  const teams = view.teams;
  const events = view.events;
  const teamMap = new Map(teams.map((tm) => [tm.id, tm]));
  const rules = rulesOf(t);
  const maxRound = matches.reduce((acc, m) => Math.max(acc, m.round ?? 0), 0);
  const suspensions = computeSuspensions(events, matches, rules, maxRound);

  // Disciplina unificada: automáticas + manuales (origen conservado, sin fusión).
  const today = leagueNow().date;
  const playedRounds = matches
    .filter((m) => m.status === 'played' || m.status === 'walkover')
    .map((m) => m.round ?? 0)
    .filter((r) => r > 0);
  const servedRemaining = (s: PlayerSuspension): number | null => {
    // throughRound = fecha de origen de la sanción (no la última del fixture:
    // con la última nunca hay partidos "después" y siempre daría 0).
    const rest = remainingSuspensionMatches(s, matches, s.asOfRound ?? maxRound);
    return rest.length > 0 ? rest.length : 0;
  };
  const incidentRoundOf = (s: SanctionRow): number | null => {
    if (!s.team_id) return null;
    const rounds = matches
      .filter((m) => (m.home_team_id === s.team_id || m.away_team_id === s.team_id) && m.played_on === s.incident_date)
      .map((m) => m.round)
      .filter((r): r is number => r != null);
    return rounds.length ? Math.max(...rounds) : null;
  };
  // Fase 8: cierre automático de sanciones cumplidas (idempotente).
  await closeFulfilledSanctions(db, t.id, { playedRounds, today, incidentRoundOf });
  const allSanctions = await sanctionsForTournament(db, t.id);
  const { active: discipline, archive: disciplineArchive } = combineDiscipline(
    suspensions.map((s) => ({ tournamentId: t.id, suspension: s, servedRemaining: servedRemaining(s) })),
    allSanctions.map((s) => ({ sanction: s, incidentRound: incidentRoundOf(s), playedRounds, today }))
  );

  // Nombres de jugadores (automáticas + manuales) en una sola tanda.
  const playerName = new Map<number, string>();
  const playerIds = new Set<number>(
    [...discipline, ...disciplineArchive].flatMap((e) => (e.playerId != null ? [e.playerId] : []))
  );
  if (playerIds.size > 0) {
    const ids = [...playerIds];
    const ph = ids.map((_, i) => `?${i + 1}`).join(',');
    const { results } = await db
      .prepare(`SELECT id, name FROM players WHERE id IN (${ph})`)
      .bind(...ids)
      .all<{ id: number; name: string }>();
    for (const row of results ?? []) playerName.set(row.id, row.name);
  }

  // Badges (reutilizados del patrón de admin).
  const originBadge = (source: DisciplineEntry['source']): string =>
    source === 'auto'
      ? '<span class="badge ghost">Automática</span>'
      : '<span class="badge amber">Manual</span>';
  const scopeBadge = (scope: 'player' | 'team'): string =>
    scope === 'team' ? '<span class="badge ghost">Equipo</span> ' : '';
  const durationBadge = (d: DisciplineEntry['duration']): string => {
    if (d.kind === 'fechas') return `<span class="badge ghost">${d.amount ?? 0} fecha${(d.amount ?? 0) === 1 ? '' : 's'}</span>`;
    if (d.kind === 'dias') return `<span class="badge ghost">${d.amount ?? 0} día${(d.amount ?? 0) === 1 ? '' : 's'}</span>`;
    return `<span class="badge ghost">Hasta el ${esc(d.untilDate ?? '—')}</span>`;
  };
  const measureBadge = (e: DisciplineEntry): string => {
    if (e.measure == null) return '';
    const label = SANCTION_MEASURE_LABELS[e.measure];
    const detail =
      e.measure === 'perdida_puntos' ? ` (${e.duration.amount ?? 0} pt${(e.duration.amount ?? 0) === 1 ? '' : 's'})`
      : e.measure === 'suspension_fechas' ? ` (${e.duration.amount ?? 0} fecha${(e.duration.amount ?? 0) === 1 ? '' : 's'})`
      : e.measure === 'suspension_dias' && e.duration.untilDate ? ` (hasta el ${esc(e.duration.untilDate)})`
      : '';
    const tone = e.measure === 'expulsion' ? 'red' : e.measure === 'advertencia' ? 'ghost' : 'amber';
    return `<span class="badge ${tone}">${esc(label)}${detail}</span>`;
  };
  const statusBadge = (status: SanctionStatus, annulReason?: string): string => {
    if (status === 'activa') return '<span class="badge red">Activa</span>';
    if (status === 'cumplida') return '<span class="badge green">Cumplida</span>';
    return `<span class="badge ghost">Anulada</span>${annulReason ? `<div class="small muted">Motivo de anulación: ${esc(annulReason)}</div>` : ''}`;
  };
  const rowFor = (e: DisciplineEntry): string => {
    const orig = e.sanctionId != null ? allSanctions.find((s) => s.id === e.sanctionId) : undefined;
    const afflicted =
      e.scope === 'team'
        ? `Equipo ${teamMap.get(e.teamId ?? -1)?.name ?? '—'}`
        : e.playerId != null
          ? `<a href="/jugador/${e.playerId}">${esc(playerName.get(e.playerId) ?? '—')}</a>`
          : '—';
    const teamName = esc(teamMap.get(e.teamId ?? -1)?.name ?? '—');
    const motivo =
      e.source === 'manual' && e.description ? `${esc(e.reason)} — ${esc(e.description)}` : esc(e.reason);
    const periodo = e.measure != null ? measureBadge(e) : durationBadge(e.duration);
    const restante =
      e.remaining != null && e.status === 'activa' && e.duration.kind !== 'hasta_fecha'
        ? `<div class="small muted">${e.remaining} ${e.duration.kind === 'fechas' ? 'fecha(s) restante(s)' : 'día(s) restante(s)'}</div>`
        : '';
    // El motivo de anulación se muestra una sola vez: en la columna Estado.
    return `<tr>
      <td>${scopeBadge(e.scope)}${afflicted}</td>
      <td>${teamName}</td>
      <td>${motivo}</td>
      <td>${periodo}${restante}</td>
      <td>${formatDateShort(e.originDate ?? '') || '—'}</td>
      <td>${statusBadge(e.status, orig?.annul_reason)}</td>
      <td>${originBadge(e.source)}</td>
    </tr>`;
  };

  const activeRows = discipline.slice().sort(sortEntries).map((e) => rowFor(e)).join('');
  const activeTable =
    activeRows
      ? `<div class="table-wrap"><table class="data">
    <thead><tr><th>Afectado</th><th>Equipo</th><th>Motivo</th><th>Período</th><th>Fecha</th><th>Estado</th><th>Origen</th></tr></thead>
    <tbody>${activeRows}</tbody></table></div>`
      : emptyNote('Sin sanciones ni suspensiones vigentes 🎉');

  const archiveRows = disciplineArchive.slice().sort(sortEntries).map((e) => rowFor(e)).join('');
  const archiveSection =
    disciplineArchive.length
      ? `<details class="mt-3" style="margin-top:10px">
    <summary style="cursor:pointer;font-weight:600">Historial (cumplidas y anuladas) · ${disciplineArchive.length}</summary>
    ${archiveRows
        ? `<div class="table-wrap" style="margin-top:8px"><table class="data">
      <thead><tr><th>Afectado</th><th>Equipo</th><th>Motivo</th><th>Período</th><th>Fecha</th><th>Estado</th><th>Origen</th></tr></thead>
      <tbody>${archiveRows}</tbody></table></div>`
        : '<p class="hint">Todavía no hay sanciones cumplidas ni anuladas.</p>'}
  </details>`
      : '';

  const body = `
<section class="hero"><div class="hero-kicker">${esc(t.name)}</div><h1>Suspensiones y sanciones</h1></section>
<section class="block"><div class="card">${activeTable}${archiveSection}</div></section>`;
  return layout({ title: `Suspensiones — ${t.name}`, active: 'suspensiones', nav: PUBLIC_NAV, mas: PUBLIC_NAV_MAS, tSlug: t.slug, body });
}

/* Re-export helpers usados por rutas */
export { matchShortLabel, matchWinnerLoser };
