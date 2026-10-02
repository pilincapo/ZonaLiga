// Fase 17 (cierre): BITÁCORA DE CAMBIOS POR PARTIDO.
//
// Hasta ahora lo único que guardaba historia de un partido era
// `match_reschedules` (Fase 13: día, hora y cancha antes y después). Todo lo
// demás se pisaba sin dejar rastro: cambiar el marcador, cambiar el estado,
// agregar o borrar un evento, aprobar la entrega de un delegado.
//
// Acá vive el armado de esa bitácora:
//   - `diffMatch` compara el partido antes y después de un guardado y devuelve
//     SOLO los campos que cambiaron. Si el administrador abre la planilla y
//     guarda sin tocar nada, la lista viene vacía y no se escribe nada: el
//     historial se lee limpio.
//   - `describeEvent` arma la frase de un evento (para los cambios de eventos).
//   - `cancelReason` es la regla del motivo obligatorio al marcar un partido
//     como Libre (o sea, cancelado: no se juega nunca y no cuenta para nadie).
//   - `insertMatchChanges` es la ÚNICA parte que toca la base: arma los INSERT.
//
// Alcance: solo partidos. No es una auditoría general del sistema.

import type { Event, Match, MatchStatus } from './types.ts';
import { MATCH_STATUS_LABELS } from './matchOps.ts';

/* ------------------------------ Acciones ------------------------------ */

export type ChangeAction =
  | 'estado'
  | 'resultado'
  | 'puntos'
  | 'dia'
  | 'hora'
  | 'cancha'
  | 'notas'
  | 'equipos'
  | 'evento'
  | 'partido'
  | 'llave';

/** Cómo se lee cada acción en la bitácora. */
export const ACTION_LABELS: Record<ChangeAction, string> = {
  estado: 'Estado',
  resultado: 'Resultado',
  puntos: 'Puntos',
  dia: 'Día',
  hora: 'Hora',
  cancha: 'Cancha',
  notas: 'Notas',
  equipos: 'Equipos',
  evento: 'Evento',
  partido: 'Partido',
  llave: 'Llave',
};

/** Actores posibles. Hoy el panel tiene una sola contraseña: no hay usuarios. */
export const ACTOR_ADMIN = 'admin';
export const ACTOR_SYSTEM = 'sistema';
/** Actor de una aprobación de entrega: `delegado:<id del equipo>`. */
export function delegateActor(teamId: number): string {
  return `delegado:${teamId}`;
}

/* ------------------------------ Diff ------------------------------ */

/** Lo mínimo del partido que se mira para detectar cambios. */
export type MatchSnapshot = Pick<
  Match,
  | 'status'
  | 'home_goals'
  | 'away_goals'
  | 'home_points'
  | 'away_points'
  | 'played_on'
  | 'kickoff_time'
  | 'venue'
  | 'notes'
  | 'home_team_id'
  | 'away_team_id'
  | 'round'
  | 'zone'
>;

export interface MatchChange {
  action: ChangeAction;
  field: string;
  oldValue: string;
  newValue: string;
  reason: string;
}

export interface DiffOptions {
  /** Motivo que se repite en cada fila del guardado. */
  reason?: string;
  /** Nombres de equipo, para que el diff de equipos no muestre ids. */
  teamNames?: Record<number, string>;
}

/** Un punto manual de puntos o ninguno: se muestra como "auto". */
function points(v: number | null): string {
  return v == null ? 'auto' : String(v);
}

/** Un id de equipo o ninguno: se muestra como "Por definir". */
function team(v: number | null, names?: Record<number, string>): string {
  if (v == null) return 'Por definir';
  return names?.[v] ?? `equipo ${v}`;
}

interface FieldSpec {
  field: string;
  action: ChangeAction;
  read: (s: MatchSnapshot, opts: DiffOptions) => string;
}

/** Campos vigilados, en el orden en que se muestran en la bitácora. */
const TRACKED: readonly FieldSpec[] = [
  { field: 'status', action: 'estado', read: (s) => s.status },
  { field: 'resultado', action: 'resultado', read: (s) => `${s.home_goals}-${s.away_goals}` },
  { field: 'puntos', action: 'puntos', read: (s) => `${points(s.home_points)} - ${points(s.away_points)}` },
  { field: 'played_on', action: 'dia', read: (s) => s.played_on },
  { field: 'kickoff_time', action: 'hora', read: (s) => s.kickoff_time },
  { field: 'venue', action: 'cancha', read: (s) => s.venue },
  { field: 'home_team_id', action: 'equipos', read: (s, o) => team(s.home_team_id, o.teamNames) },
  { field: 'away_team_id', action: 'equipos', read: (s, o) => team(s.away_team_id, o.teamNames) },
  { field: 'round', action: 'partido', read: (s) => (s.round == null ? 'sin fecha' : String(s.round)) },
  { field: 'zone', action: 'partido', read: (s) => s.zone },
  { field: 'notes', action: 'notas', read: (s) => s.notes },
];

/**
 * Cambios entre dos versiones del partido. Solo los que de verdad cambiaron, en
 * el orden de la tabla. Si no cambió nada, devuelve lista vacía: ese es el
 * punto de todo esto (guardar sin tocar nada no ensucia el historial).
 */
export function diffMatch(before: MatchSnapshot, after: MatchSnapshot, opts: DiffOptions = {}): MatchChange[] {
  const reason = (opts.reason ?? '').trim();
  const out: MatchChange[] = [];
  for (const spec of TRACKED) {
    const oldValue = spec.read(before, opts);
    const newValue = spec.read(after, opts);
    if (oldValue === newValue) continue;
    out.push({ action: spec.action, field: spec.field, oldValue, newValue, reason });
  }
  return out;
}

/* ------------------------------ Eventos ------------------------------ */

/**
 * Frase de un evento para la bitácora: "Gol · Soto 23'", "Amarilla · sin
 * jugador". Se usa el nombre del jugador si se conoce; si el jugador ya no
 * existe en la base, cae al id para no perder el registro.
 */
export function describeEvent(
  ev: Pick<Event, 'type' | 'minute' | 'player_id'>,
  playerName?: string | null,
  typeLabel?: string
): string {
  const tipo = typeLabel ?? ev.type;
  const quien = playerName ?? (ev.player_id != null ? `#${ev.player_id}` : 'sin jugador');
  return ev.minute != null ? `${tipo} · ${quien} ${ev.minute}'` : `${tipo} · ${quien}`;
}

/** Fila de bitácora de un evento que se agregó o se borró. */
export function eventChange(ev: Pick<Event, 'type' | 'minute' | 'player_id'>, playerName: string | null, typeLabel: string, motivo: 'agregado' | 'eliminado', reason = ''): MatchChange {
  return {
    action: 'evento',
    field: motivo,
    oldValue: motivo === 'eliminado' ? describeEvent(ev, playerName, typeLabel) : '',
    newValue: motivo === 'agregado' ? describeEvent(ev, playerName, typeLabel) : '',
    reason,
  };
}

/**
 * Cómo están cargados los autores de gol ahora, por camiseta. Al guardar la
 * los goles se reescriben: esto es lo que se comparaba antes y después para
 * dejar asentado a quién se le atribuyó el gol (o a quién se le sacó).
 */
export function goalAuthorsLabel(
  events: readonly Pick<Event, 'team_id' | 'type' | 'player_id'>[],
  sides: { home: number | null; away: number | null },
  names: Record<number, string>
): string {
  const list = (teamId: number | null): string => {
    if (teamId == null) return '—';
    const autores = events
      .filter((e) => e.team_id === teamId && (e.type === 'goal' || e.type === 'own_goal'))
      .map((e) => {
        if (e.type === 'own_goal') return 'en contra';
        return e.player_id != null ? names[e.player_id] ?? `#${e.player_id}` : 'sin autor';
      });
    return autores.length ? autores.join(', ') : '—';
  };
  return `Local: ${list(sides.home)} · Visitante: ${list(sides.away)}`;
}

/** Fila de bitácora que asienta el antes y el después de los autores de gol. */
export function goalAuthorsChange(oldLabel: string, newLabel: string, reason = ''): MatchChange {
  return { action: 'evento', field: 'autores', oldValue: oldLabel, newValue: newLabel, reason };
}

/** Fila mínima de evento para poder compararlas. */
export type EventRow = Pick<Event, 'type' | 'team_id' | 'player_id' | 'minute'>;

/** Identidad de un evento para saber si es el mismo antes y después. */
function eventKey(e: EventRow): string {
  return [e.type, e.team_id ?? '', e.player_id ?? '', e.minute ?? ''].join('|');
}

/**
 * Eventos que se agregaron y que se quitaron entre dos versiones. Se usa
 * cuando una entrega de delegado reemplaza los eventos de un equipo: los
 * borrados y los nuevos quedan asentados uno por uno.
 */
export function diffEvents(
  before: readonly EventRow[],
  after: readonly EventRow[],
  names: Record<number, string>,
  labels: Record<string, string>,
  reason = ''
): MatchChange[] {
  const rest = [...before];
  const out: MatchChange[] = [];
  const take = (want: string): EventRow | null => {
    const i = rest.findIndex((e) => eventKey(e) === want);
    return i >= 0 ? rest.splice(i, 1)[0]! : null;
  };
  for (const e of after) {
    if (take(eventKey(e))) continue; // ya estaba
    out.push(eventChange(e, names[e.player_id ?? -1] ?? null, labels[e.type] ?? e.type, 'agregado', reason));
  }
  for (const e of rest) {
    out.push(eventChange(e, names[e.player_id ?? -1] ?? null, labels[e.type] ?? e.type, 'eliminado', reason));
  }
  return out;
}

/* ------------------------------ Cancelado = Libre ------------------------------ */

/**
 * Un partido "Libre" (bye) es el que no se juega nunca: no cuenta para la
 * tabla, no bloquea las llaves y no se re-agenda. Es el estado que se usa
 * cuando un partido queda cancelado. Para que quede dicho POR QUÉ, el motivo
 * es obligatorio cada vez que se entra a ese estado.
 *
 * Guardar un partido que YA estaba en Libre no vuelve a pedir el motivo: no
 * está pasando nada nuevo.
 */
export function needsCancelReason(beforeStatus: string, nextStatus: string): boolean {
  return nextStatus === 'bye' && beforeStatus !== 'bye';
}

/** Mensaje de error cuando falta ese motivo. */
export function cancelReasonError(nextStatus: string): string {
  return `Marcaste el partido como "${MATCH_STATUS_LABELS[nextStatus as MatchStatus] ?? nextStatus}": contá por qué no se juega (queda registrado en la bitácora).`;
}

/** El motivo, ya limpio y con tope. Vacío si no se mandó nada. */
export function cleanReason(raw: unknown, max = 500): string {
  return String(raw ?? '')
    .trim()
    .slice(0, max);
}

/* ------------------------------ Base de datos ------------------------------ */

export interface MatchChangeRow {
  id: number;
  match_id: number;
  tournament_id: number;
  changed_at: string;
  actor: string;
  action: string;
  field: string;
  old_value: string;
  new_value: string;
  reason: string;
}

/** Inserta los cambios de un partido. Sin cambios, no toca nada. */
export async function insertMatchChanges(
  db: D1Database,
  match: { id: number; tournament_id: number },
  changes: readonly MatchChange[],
  actor: string = ACTOR_ADMIN
): Promise<number> {
  if (changes.length === 0) return 0;
  const stmts = changes.map((c) =>
    db
      .prepare(
        `INSERT INTO match_changes (match_id, tournament_id, actor, action, field, old_value, new_value, reason)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
      )
      .bind(match.id, match.tournament_id, actor, c.action, c.field, c.oldValue, c.newValue, c.reason)
  );
  await db.batch(stmts);
  return changes.length;
}

/** Historial de un partido, del más reciente al más viejo. */
export async function listMatchChanges(db: D1Database, matchId: number, limit = 100): Promise<MatchChangeRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM match_changes WHERE match_id = ?1 ORDER BY id DESC LIMIT ?2')
    .bind(matchId, limit)
    .all<MatchChangeRow>();
  return results ?? [];
}