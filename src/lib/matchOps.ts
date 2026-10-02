// Fase 17: validación de la operación de partidos (planilla y eventos).
//
// Dominio puro, sin base ni HTML: traduce lo que llega del formulario a datos
// que la base acepta de verdad. Hasta ahora el panel hacía `as MatchStatus` o
// `Number(...)` y confiaba en los CHECK de SQLite: un dato raro devolvía un
// error 500 en vez de un mensaje. Acá todo se valida antes de escribir.
//
// No cambia el modelo: los estados y tipos son los mismos que ya acepta la
// base, y la competencia, el fixture y los playoffs quedan intactos.

import type { EventType, MatchStatus } from './types.ts';
import { MAX_GOALS } from './sheet.ts';

/* ------------------------------ Estados y eventos ------------------------------ */

/** Estados de partido que acepta la base (mismos del CHECK de `matches`). */
export const MATCH_STATUSES: readonly MatchStatus[] = [
  'scheduled',
  'played',
  'postponed',
  'suspended',
  'walkover',
  'bye',
];

/** Cómo se muestran los estados en el panel. `bye` es "Libre": no se juega. */
export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  scheduled: 'Programado',
  played: 'Jugado',
  postponed: 'Postergado',
  suspended: 'Suspendido',
  walkover: 'Walkover',
  bye: 'Libre',
};

/** Tipos de evento que acepta la base (mismos del CHECK de `events`). */
export const EVENT_TYPES: readonly EventType[] = ['goal', 'own_goal', 'yellow', 'red'];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  goal: 'Gol',
  own_goal: 'En contra',
  yellow: 'Amarilla',
  red: 'Roja',
};

export function isMatchStatus(value: unknown): value is MatchStatus {
  return typeof value === 'string' && (MATCH_STATUSES as readonly string[]).includes(value);
}

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value);
}

/* ------------------------------ Límites de campo ------------------------------ */

/** Minuto máximo: 90' + prórroga y descuento. Es el `max` del input. */
export const MAX_MINUTE = 130;
/**
 * Tope del campo de puntos manuales. Ojo: `home_points`/`away_points` tienen
 * DOS usos que ya existían — override de puntos en la tabla (0 a 3) y, cuando
 * hay empate en goles, resultado de los penales de la llave (cualquier entero
 * mayor). Por eso el tope es holgado: filtra el `99` tipeado sin error, pero
 * deja pasar un 5-3 de penales. No bajar este número sin tocar los playoffs.
 */
export const MAX_POINTS_OVERRIDE = 30;
/** Tope de las notas del partido. */
export const MAX_NOTES = 1000;
/** Tope de la cancha. */
export const MAX_VENUE = 200;

/* ------------------------------ Resultado de validación ------------------------------ */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const good = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

/* ------------------------------ Parseadores ------------------------------ */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Fecha jugada: vacía o `AAAA-MM-DD` de verdad (rechaza 2026-02-31). */
export function parsePlayedOn(raw: unknown): Parsed<string> {
  const v = String(raw ?? '').trim();
  if (v === '') return good('');
  if (!DATE_RE.test(v)) return fail('La fecha no tiene el formato AAAA-MM-DD');
  const [y, mo, d] = v.split('-').map((n) => Number(n)) as [number, number, number];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return fail('La fecha no existe en el calendario');
  }
  return good(v);
}

/** Hora de arranque: vacía o `HH:MM` (00-23 / 00-59). */
export function parseKickoff(raw: unknown): Parsed<string> {
  const v = String(raw ?? '').trim();
  if (v === '') return good('');
  if (!TIME_RE.test(v)) return fail('La hora no tiene el formato HH:MM');
  return good(v);
}

/** Cancha: texto corto, sin control chars. */
export function parseVenue(raw: unknown): Parsed<string> {
  const v = String(raw ?? '').trim();
  if (v.length > MAX_VENUE) return fail(`La cancha es demasiado larga (máximo ${MAX_VENUE} caracteres)`);
  if (/[\u0000-\u001f\u007f]/.test(v)) return fail('La cancha tiene caracteres inválidos');
  return good(v);
}

/** Notas: texto libre con tope de largo. */
export function parseNotes(raw: unknown): Parsed<string> {
  const v = String(raw ?? '').trim();
  if (v.length > MAX_NOTES) return fail(`Las notas son demasiado largas (máximo ${MAX_NOTES} caracteres)`);
  return good(v);
}

/** Goles de un equipo: entero de 0 a MAX_GOALS. Vacío = 0. */
export function parseGoals(raw: unknown, label: string): Parsed<number> {
  const v = String(raw ?? '').trim();
  if (v === '') return good(0);
  const n = Number(v);
  if (!Number.isInteger(n)) return fail(`${label}: la cantidad de goles no es un número entero`);
  if (n < 0) return fail(`${label}: los goles no pueden ser negativos`);
  if (n > MAX_GOALS) return fail(`${label}: como máximo ${MAX_GOALS} goles`);
  return good(n);
}

/**
 * Minuto del evento: vacío (queda sin minuto) o entero de 0 a MAX_MINUTE.
 * Antes se aceptaban -5 y 500 porque `Number()` no mira el rango.
 */
export function parseMinute(raw: unknown): Parsed<number | null> {
  const v = String(raw ?? '').trim();
  if (v === '') return good(null);
  const n = Number(v);
  if (!Number.isInteger(n)) return fail('El minuto tiene que ser un número entero');
  if (n < 0 || n > MAX_MINUTE) return fail(`El minuto va de 0 a ${MAX_MINUTE}`);
  return good(n);
}

/**
 * Override manual de puntos: vacío = automático, o entero de 0 a
 * MAX_POINTS_OVERRIDE. Antes la pantalla ponía max="3" pero el servidor
 * guardaba 99 tal cual y, con el partido jugado, la tabla sumaba 99 puntos.
 */
export function parsePointsOverride(raw: unknown, label: string): Parsed<number | null> {
  const v = String(raw ?? '').trim();
  if (v === '') return good(null);
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > MAX_POINTS_OVERRIDE) {
    return fail(
      `${label}: tiene que ser un número entero de 0 a ${MAX_POINTS_OVERRIDE}, o vacío para que se calcule solo`
    );
  }
  return good(n);
}

/* ------------------------------ Partido y evento ------------------------------ */

/**
 * ¿El equipo es uno de los dos del partido? Un evento cargado con un
 * `team_id` de un tercero se guardaba igual y después contaminaba las
 * tarjetas públicas de un equipo que no jugó nunca.
 */
export function isSideTeam(teamId: unknown, homeTeamId: number | null, awayTeamId: number | null): boolean {
  const id = Number(teamId);
  if (!Number.isInteger(id)) return false;
  return (homeTeamId != null && id === homeTeamId) || (awayTeamId != null && id === awayTeamId);
}

export interface SheetFormFields {
  status?: unknown;
  home_goals?: unknown;
  away_goals?: unknown;
  home_points?: unknown;
  away_points?: unknown;
  played_on?: unknown;
  kickoff_time?: unknown;
  venue?: unknown;
  notes?: unknown;
  /** Casilla de confirmación para pisar autores de gol ya cargados. */
  confirm_goles?: unknown;
}

export interface ValidatedSheet {
  status: MatchStatus;
  homeGoals: number;
  awayGoals: number;
  homePoints: number | null;
  awayPoints: number | null;
  playedOn: string;
  kickoffTime: string;
  venue: string;
  notes: string;
}

export interface SheetContext {
  /** Cuántos goles del partido tienen un autor nombrado (no "en contra" ni "sin autor"). */
  authoredGoals: number;
}

/**
 * Aviso de sobrescritura: guardar REEMPLAZA los autores de gol. Si el partido
 * ya tiene autores cargados y la nueva declaración declara menos goles, se
 * perderían sin avisar. Devuelve el texto (o null si no hay nada que perder).
 */
export function goalOverwriteNotice(authoredGoals: number, nextTotal: number): string | null {
  if (authoredGoals <= 0 || nextTotal >= authoredGoals) return null;
  const n = authoredGoals - nextTotal;
  return n === 1
    ? 'Vas a borrar 1 autor de gol que ya está cargado.'
    : `Vas a borrar ${n} autores de gol que ya están cargados.`;
}

/** ¿Este guardado necesita la casilla de confirmación? */
export function needsGoalOverwriteConfirm(authoredGoals: number, nextTotal: number, confirmed: boolean): boolean {
  return goalOverwriteNotice(authoredGoals, nextTotal) != null && !confirmed;
}

/** Error de servidor cuando falta esa confirmación. */
export function goalOverwriteError(authoredGoals: number, nextTotal: number): string {
  const aviso = goalOverwriteNotice(authoredGoals, nextTotal) ?? 'Vas a pisar los autores de gol cargados.';
  return `${aviso} Marcá la casilla de confirmación para guardar igual.`;
}

/**
 * Valida el formulario principal de la planilla. Devuelve el primer problema
 * con un mensaje que se puede mostrar tal cual, o los datos ya saneados.
 */
export function validateSheetForm(fields: SheetFormFields, ctx: SheetContext): Parsed<ValidatedSheet> {
  const statusRaw = String(fields.status ?? '').trim();
  if (!isMatchStatus(statusRaw)) {
    return fail(
      statusRaw === ''
        ? 'Falta elegir el estado del partido'
        : `Estado inválido: "${statusRaw}". Los estados posibles son: ${MATCH_STATUSES.map((s) => MATCH_STATUS_LABELS[s]).join(', ')}.`
    );
  }
  const homeGoals = parseGoals(fields.home_goals, 'Local');
  if (!homeGoals.ok) return homeGoals;
  const awayGoals = parseGoals(fields.away_goals, 'Visitante');
  if (!awayGoals.ok) return awayGoals;
  const homePoints = parsePointsOverride(fields.home_points, 'Puntos del local');
  if (!homePoints.ok) return homePoints;
  const awayPoints = parsePointsOverride(fields.away_points, 'Puntos del visitante');
  if (!awayPoints.ok) return awayPoints;
  const playedOn = parsePlayedOn(fields.played_on);
  if (!playedOn.ok) return playedOn;
  const kickoffTime = parseKickoff(fields.kickoff_time);
  if (!kickoffTime.ok) return kickoffTime;
  const venue = parseVenue(fields.venue);
  if (!venue.ok) return venue;
  const notes = parseNotes(fields.notes);
  if (!notes.ok) return notes;

  const nextTotal = homeGoals.value + awayGoals.value;
  const confirmed = String(fields.confirm_goles ?? '') === '1';
  if (needsGoalOverwriteConfirm(ctx.authoredGoals, nextTotal, confirmed)) {
    return fail(goalOverwriteError(ctx.authoredGoals, nextTotal));
  }

  return good({
    status: statusRaw,
    homeGoals: homeGoals.value,
    awayGoals: awayGoals.value,
    homePoints: homePoints.value,
    awayPoints: awayPoints.value,
    playedOn: playedOn.value,
    kickoffTime: kickoffTime.value,
    venue: venue.value,
    notes: notes.value,
  });
}

export interface EventFormFields {
  team_id?: unknown;
  player_id?: unknown;
  type?: unknown;
  minute?: unknown;
}

export interface ValidatedEvent {
  teamId: number;
  playerId: number;
  type: EventType;
  minute: number | null;
}

export interface EventContext {
  homeTeamId: number | null;
  awayTeamId: number | null;
  /** Plantilla de cada equipo del partido (para exigir que el jugador sea de ese lado). */
  homeRoster: readonly number[];
  awayRoster: readonly number[];
}

/**
 * Valida el alta de un evento: tipo real, equipo del partido, jugador de esa
 * misma plantilla y minuto dentro del rango. Antes cada uno de esos cuatro
 * puntos pasaba sin control (y dos terminaban en error 500).
 */
export function validateEventForm(fields: EventFormFields, ctx: EventContext): Parsed<ValidatedEvent> {
  const typeRaw = String(fields.type ?? '').trim();
  if (!isEventType(typeRaw)) {
    return fail(
      typeRaw === ''
        ? 'Falta elegir el tipo de evento'
        : `Tipo de evento inválido: "${typeRaw}". Solo van ${EVENT_TYPES.map((t) => EVENT_TYPE_LABELS[t]).join(', ')}.`
    );
  }
  if (!isSideTeam(fields.team_id, ctx.homeTeamId, ctx.awayTeamId)) {
    return fail('Elegí el equipo del partido al que pertenece el evento');
  }
  const teamId = Number(fields.team_id);
  const roster = teamId === ctx.homeTeamId ? ctx.homeRoster : ctx.awayRoster;
  const playerId = Number(fields.player_id);
  if (!Number.isInteger(playerId) || !roster.includes(playerId)) {
    return fail('Ese jugador no está en la plantilla del equipo');
  }
  const minute = parseMinute(fields.minute);
  if (!minute.ok) return minute;
  return good({ teamId, playerId, type: typeRaw, minute: minute.value });
}

/**
 * ¿Este evento es de este partido? El borrado se hacía por `id` de evento sin
 * mirar el partido: desde la planilla de un partido se borraban eventos de
 * otro. Ahora la consulta viene con el `match_id` puesto.
 */
export function eventBelongsToMatch(event: { match_id: number } | null | undefined, matchId: number): boolean {
  return event != null && event.match_id === matchId;
}