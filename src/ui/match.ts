// Piezas de render de partidos y equipos: escudos, filas de fixture,
// estado, columna de llaves y eventos de la ficha. Las consumen las páginas
// públicas; el chrome del sitio (layout, nav, footer) vive en components.ts.

import { esc, escUrl } from '../lib/html.ts';
import { formatDateShort } from '../lib/format.ts';
import type { Event, Match, Team } from '../lib/types.ts';
import type { BracketColumn, BracketMatchView } from '../lib/bracket.ts';
import { sourceLabel } from '../lib/bracket.ts';
import { isCrossoverMatch } from '../lib/crossover.ts';

export function crest(
  team: { name?: string; short_name: string; color: string; logo_url: string } | null | undefined,
  size: '' | 'sm' | 'lg' = ''
): string {
  if (!team) return `<span class="crest ${size}" style="background:#2a3a4d">?</span>`;
  if (team.logo_url) {
    return `<span class="crest ${size}"><img src="${escUrl(team.logo_url)}" alt=""></span>`;
  }
  const short = team.short_name || (team.name ?? '').slice(0, 3).toUpperCase() || '···';
  return `<span class="crest ${size}" style="background:${escUrl(team.color)}">${esc(short)}</span>`;
}

export function teamCell(
  team: { id: number; name: string; slug: string; short_name: string; color: string; logo_url: string } | null | undefined,
  opts: { link?: boolean; placeholder?: string; align?: 'left' | 'right' } = {}
): string {
  const cls = opts.align === 'right' ? 'team-cell away' : 'team-cell';
  if (!team) {
    return `<span class="${cls}"><span class="placeholder">${esc(opts.placeholder ?? 'Por definir')}</span></span>`;
  }
  const name = opts.link === false ? esc(team.name) : `<a href="/equipos/${escUrl(team.slug)}">${esc(team.name)}</a>`;
  return `<span class="${cls}">${crest(team)}<span class="tname">${name}</span></span>`;
}

export function statusTag(m: Match): string {
  if (m.status === 'scheduled') {
    const time = m.kickoff_time ? ` · ${esc(m.kickoff_time)}` : '';
    return `<span class="status-tag scheduled">${formatDateShort(m.played_on) || 'A definir'}${time}</span>`;
  }
  const labels: Record<string, string> = {
    postponed: 'Postergado',
    suspended: 'Suspendido',
    walkover: 'Walkover',
    bye: 'Libre',
    played: 'Jugado',
  };
  return `<span class="status-tag ${m.status}">${labels[m.status] ?? m.status}</span>`;
}

/** Marca distintiva de cruce entre zonas (partidos generados con la bolsa mezclada). */
export function crossoverBadge(): string {
  return '<span class="badge amber" title="Cruce entre zonas: no suma a la tabla de zona">Cruce</span> ';
}

/**
 * Distintivo de zona del equipo en una fila de partido. Con la lista
 * mezclada (ya no agrupada por zona), el badge es lo que permite ver de un
 * vistazo quién pertenece a cada zona. El color sale del accent del tema;
 * el texto es el nombre de la zona (A, B, Norte…).
 */
export function zoneBadge(zone: string, align: 'left' | 'right' = 'left'): string {
  const z = zone.trim();
  if (!z) return '';
  const title = `Equipo de la zona ${z}`;
  const side = align === 'right' ? ' style="margin-left:6px"' : ' style="margin-right:6px"';
  return `<span class="badge info zone-badge" title="${esc(title)}"${side}>${esc(z)}</span>`;
}

/**
 * Centro de la fila: hora/fecha/cancha, marcador con link a la ficha, o
 * estado. Detalle interno de matchRow. `extra` (cancha) se agrega debajo
 * de la hora en programados.
 */
function matchCenter(m: Match, extra = ''): string {
  if (m.status === 'scheduled') {
    return `<div class="match-center"><span class="score-time">${esc(m.kickoff_time || '')}</span><span class="score-time">${formatDateShort(m.played_on)}</span>${extra}</div>`;
  }
  if (m.status === 'played' || m.status === 'walkover') {
    return `<div class="match-center"><a class="score" href="/partido/${m.id}">${m.home_goals} - ${m.away_goals}</a><span class="score-time">${formatDateShort(m.played_on)}</span>${extra}</div>`;
  }
  return `<div class="match-center"><a class="score" style="opacity:.55" href="/partido/${m.id}">- : -</a><span class="score-time">${statusTag(m)}</span></div>`;
}

export function matchRow(
  m: Match,
  teamMap: Map<number, Team>,
  opts: {
    homePlaceholder?: string;
    awayPlaceholder?: string;
    /** equipo → zona: para los cruces, cuya columna zone está vacía. */
    zoneOfTeam?: Map<number, string>;
  } = {}
): string {
  const home = m.home_team_id != null ? teamMap.get(m.home_team_id) : undefined;
  const away = m.away_team_id != null ? teamMap.get(m.away_team_id) : undefined;
  const cruce = isCrossoverMatch(m) ? crossoverBadge() : '';
  // Los partidos de zona traen la zona en el partido (misma para los dos).
  // Los cruces entre zonas no: cada equipo es de una zona distinta, que se
  // deriva de la config del torneo vía zoneOfTeam.
  const zonaHome = m.zone || opts.zoneOfTeam?.get(m.home_team_id ?? -1) || '';
  const zonaAway = m.zone || opts.zoneOfTeam?.get(m.away_team_id ?? -1) || '';
  // Cancha: visible si el partido la tiene asignada (el fixture ordena por
  // cancha y hora; sin la cancha en la fila el orden no se entiende).
  const cancha = m.venue
    ? `<span class="score-time" title="Cancha">${esc(m.venue)}</span>`
    : '';
  return `<div class="match-row">
  ${teamCell(home, { placeholder: opts.homePlaceholder, align: 'left' })}${zoneBadge(zonaHome, 'left')}
  ${cruce}${matchCenter(m, cancha)}
  ${zoneBadge(zonaAway, 'right')}${teamCell(away, { placeholder: opts.awayPlaceholder, align: 'right' })}
</div>`;
}

export function bracketColumn(col: BracketColumn, teamMap: Map<number, Team>): string {
  const rows = col.matches
    .map((v: BracketMatchView) => {
      const m = v.match;
      const home = m && m.home_team_id != null ? teamMap.get(m.home_team_id) : undefined;
      const away = m && m.away_team_id != null ? teamMap.get(m.away_team_id) : undefined;
      const homeName = home
        ? teamCell(home, { align: 'left' })
        : `<span class="team-cell"><span class="placeholder">${esc(sourceLabel(m?.home_source ?? ''))}</span></span>`;
      const awayName = away
        ? teamCell(away, { align: 'right' })
        : `<span class="team-cell away"><span class="placeholder">${esc(sourceLabel(m?.away_source ?? ''))}</span></span>`;
      const center = m
        ? matchCenter(m)
        : `<div class="match-center"><span class="score-time">a definir</span></div>`;
      return `<div class="match-row">${homeName}${center}${awayName}</div>`;
    })
    .join('');
  return `<div class="bracket-col"><h3>${esc(col.title)}</h3>${rows || '<div class="empty-note">Sin partidos</div>'}</div>`;
}

/** Detalle interno de eventRow. */
function eventIcon(type: Event['type']): string {
  const map: Record<string, string> = { goal: '⚽', own_goal: '🔁', yellow: '🟨', red: '🟥' };
  return `<span class="evt ${type}">${map[type] ?? '•'}</span>`;
}

export function eventRow(
  e: Event,
  playerMap: Map<number, { name: string; team_id: number }>,
  teamMap: Map<number, Team>,
  match: Match
): string {
  const p = e.player_id != null ? playerMap.get(e.player_id) : undefined;
  const side = e.team_id === match.home_team_id ? 'left' : 'right';
  const who = p ? `<a href="/jugador/${e.player_id}">${esc(p.name)}</a>` : '<span class="faint">—</span>';
  const min = e.minute != null ? `${e.minute}'` : '';
  const cell =
    side === 'left'
      ? `<span class="when">${min}</span>${eventIcon(e.type)}<span class="grow">${who}</span>`
      : `<span class="grow side-r"><span class="team-cell">${who}</span></span>${eventIcon(e.type)}<span class="when" style="text-align:right">${min}</span>`;
  return `<div class="event-row">${cell}</div>`;
}
