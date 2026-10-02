// Fase 15: calendario operativo del fixture.
//
// Dominio puro (sin base ni HTML): clasifica cada partido en su estado
// operativo, aplica los filtros del calendario (zona, jornada, estado) y
// arma los textos que muestran la fecha/hora/cancha vigente de un partido
// reprogramado. No genera ni reprograma nada: la competencia y el motor del
// fixture siguen intactos.

import type { Match } from './types.ts';
import type { RescheduleRecord } from './reschedule.ts';
import { formatDateShort } from './format.ts';
import { esc } from './html.ts';

/** Estado operativo de un partido en el calendario. */
export type MatchState =
  | 'jugado'
  | 'pendiente'
  | 'reprogramado'
  | 'postergado'
  | 'suspendido'
  | 'libre';

export const MATCH_STATE_LABELS: Record<MatchState, string> = {
  jugado: 'Jugado',
  pendiente: 'Pendiente',
  reprogramado: 'Reprogramado',
  postergado: 'Postergado',
  suspendido: 'Suspendido',
  libre: 'Libre',
};

/** Tono del distintivo de estado (clases `badge` del CSS). */
export const MATCH_STATE_TONES: Record<MatchState, string> = {
  jugado: 'green',
  pendiente: 'info',
  reprogramado: 'amber',
  postergado: 'amber',
  suspendido: 'red',
  libre: 'ghost',
};

/** Filtro de estado: '' = todos. */
export type MatchStateFilter = MatchState | '';

/** Todos los estados, en el orden en que se ofrecen como filtro. */
export const MATCH_STATE_FILTERS: MatchState[] = [
  'pendiente',
  'reprogramado',
  'postergado',
  'jugado',
  'suspendido',
  'libre',
];

/**
 * Estado operativo de un partido. `rescheduled` son los partidos con al menos
 * una reprogramación registrada (historial de la Fase 13): mientras el
 * partido no se jugó, el estado es 'reprogramado' y su día, hora y cancha
 * guardados son los vigentes.
 *
 * Un partido 'postergado' que además fue reprogramado cuenta como
 * 'reprogramado': ya tiene fecha nueva, así que lo que hay que hacer es
 * jugarlo, no buscarle lugar.
 */
export function matchState(m: Match, rescheduled?: ReadonlySet<number> | null): MatchState {
  if (m.status === 'played' || m.status === 'walkover') return 'jugado';
  if (m.status === 'bye') return 'libre';
  if (m.status === 'suspended') return 'suspendido';
  if (rescheduled?.has(m.id)) return 'reprogramado';
  if (m.status === 'postponed') return 'postergado';
  return 'pendiente';
}

/** ¿El partido tiene reprogramación registrada? (sin importar su estado). */
export function wasRescheduled(id: number, rescheduled?: ReadonlySet<number> | null): boolean {
  return rescheduled?.has(id) === true;
}

/** IDs de los partidos con al menos una reprogramación, desde el historial. */
export function rescheduledIds(records: readonly RescheduleRecord[]): Set<number> {
  const out = new Set<number>();
  for (const r of records) if (r.match_id != null) out.add(r.match_id);
  return out;
}

/** Filtros del calendario operativo. Vacíos = sin filtro. */
export interface CalendarFilters {
  /** Nombre de zona/grupo; '' = todas. */
  zone: string;
  /** Jornada (número de fecha); null = todas. */
  round: number | null;
  /** Estado operativo; '' = todos. */
  state: MatchStateFilter;
}

export const EMPTY_CALENDAR_FILTERS: CalendarFilters = { zone: '', round: null, state: '' };

const STATES: ReadonlySet<string> = new Set(MATCH_STATE_FILTERS as readonly string[]);

/**
 * Lee los filtros desde la query (?zona=&jornada=&estado=). Tolera valores
 * raros: una jornada no numérica o un estado desconocido vuelven a "todos".
 */
export function parseCalendarFilters(query: {
  zona?: string;
  jornada?: string;
  estado?: string;
}): CalendarFilters {
  const zone = (query.zona ?? '').trim();
  const roundRaw = (query.jornada ?? '').trim();
  const round = /^\d+$/.test(roundRaw) ? Number(roundRaw) : null;
  const state = (query.estado ?? '').trim();
  return {
    zone,
    round: round != null && round > 0 ? round : null,
    state: STATES.has(state) ? (state as MatchState) : '',
  };
}

/** ¿Hay algún filtro activo? (para mostrar el botón "Limpiar"). */
export function hasActiveFilters(f: CalendarFilters): boolean {
  return f.zone !== '' || f.round != null || f.state !== '';
}

/** Aplica los filtros a una lista de partidos. */
export function filterMatches(
  matches: readonly Match[],
  filters: CalendarFilters,
  rescheduled?: ReadonlySet<number> | null
): Match[] {
  return matches.filter((m) => {
    if (filters.zone && m.zone !== filters.zone) return false;
    if (filters.round != null && m.round !== filters.round) return false;
    if (filters.state && matchState(m, rescheduled) !== filters.state) return false;
    return true;
  });
}

/** Conteo por estado, para los números de arriba del calendario. */
export function countByState(
  matches: readonly Match[],
  rescheduled?: ReadonlySet<number> | null
): Record<MatchState, number> {
  const out: Record<MatchState, number> = {
    jugado: 0,
    pendiente: 0,
    reprogramado: 0,
    postergado: 0,
    suspendido: 0,
    libre: 0,
  };
  for (const m of matches) out[matchState(m, rescheduled)] += 1;
  return out;
}

/** Zonas/grupos presentes en los partidos (para el desplegable de filtro). */
export function zonesOfMatches(matches: readonly Match[]): string[] {
  const out = new Set<string>();
  for (const m of matches) {
    const z = m.zone.trim();
    if (z) out.add(z);
  }
  return [...out].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
}

/** Jornadas presentes en los partidos (para el desplegable de filtro). */
export function roundsOfMatches(matches: readonly Match[]): number[] {
  const out = new Set<number>();
  for (const m of matches) if (m.round != null) out.add(m.round);
  return [...out].sort((a, b) => a - b);
}

/**
 * Fecha/hora/cancha vigentes de un partido, en una línea para la tabla.
 * Para un reprogramado son justamente los datos nuevos (los que se guardaron
 * al reprogramar): es lo que siempre tiene que verse en pantalla.
 */
export function vigenteLine(m: Pick<Match, 'played_on' | 'kickoff_time' | 'venue'>): string {
  const parts: string[] = [];
  const day = m.played_on ? formatDateShort(m.played_on) || m.played_on : '';
  parts.push(day || 'día a definir');
  parts.push(m.kickoff_time || 'hora a definir');
  parts.push(m.venue || 'sin cancha');
  return parts.join(' · ');
}

/**
 * Detalle de una reprogramación para la tabla: día/hora/cancha vigentes y el
 * motivo del último cambio. Vacío si el partido nunca se reprogramó.
 */
export function rescheduleDetail(
  m: Pick<Match, 'played_on' | 'kickoff_time' | 'venue'>,
  records: readonly RescheduleRecord[] | undefined
): string {
  if (!records || records.length === 0) return '';
  const last = records[0]!; // el historial viene ordenado del más nuevo al más viejo
  const motivo = last.reason ? `<div class="hint" style="margin:0">Motivo: ${esc(last.reason)}</div>` : '';
  const anterior = rescheduleOldLine(last);
  const antes = anterior ? `<div class="hint" style="margin:0">Antes: ${anterior}</div>` : '';
  return `<div class="cal-vigente">${vigenteLine(m)}</div>${antes}${motivo}`;
}

/** Línea "antes → después" de un registro del historial. */
export function rescheduleChangeLine(r: RescheduleRecord): string {
  return `${rescheduleDayTimeVenue(r.old_played_on, r.old_kickoff_time, r.old_venue)} → ${rescheduleDayTimeVenue(
    r.new_played_on,
    r.new_kickoff_time,
    r.new_venue
  )}`;
}

function rescheduleOldLine(r: RescheduleRecord): string {
  return rescheduleDayTimeVenue(r.old_played_on, r.old_kickoff_time, r.old_venue);
}

/** "sáb 03/05 · 18:00 · Cancha Norte" a partir de los tres datos sueltos. */
export function rescheduleDayTimeVenue(day: string, time: string, venue: string): string {
  const d = day ? formatDateShort(day) || day : 'día a definir';
  return `${d} · ${time || 'hora a definir'} · ${venue || 'sin cancha'}`;
}

/** ¿Este partido sigue esperando que se le defina día, hora o cancha? */
export function needsScheduling(m: Match): boolean {
  if (m.status !== 'scheduled') return false;
  return !m.played_on || !m.kickoff_time || !m.venue;
}

/** Resumen en una línea para el pie del calendario. */
export function calendarSummaryLine(
  counts: Record<MatchState, number>,
  visible: number,
  total: number
): string {
  const parts: string[] = [];
  if (counts.reprogramado > 0) parts.push(`${counts.reprogramado} reprogramado(s)`);
  if (counts.pendiente > 0) parts.push(`${counts.pendiente} pendiente(s)`);
  if (counts.postergado > 0) parts.push(`${counts.postergado} postergado(s)`);
  if (counts.jugado > 0) parts.push(`${counts.jugado} jugado(s)`);
  if (!parts.length) parts.push('sin partidos');
  const base = parts.join(' · ');
  return visible === total ? base : `${base} · mostrando ${visible} de ${total}`;
}
