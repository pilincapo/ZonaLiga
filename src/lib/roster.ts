// Fase 16: equipos y jugadores.
//
// Dominio puro (sin base ni HTML): valida los datos que llegan del formulario
// de alta/edición y decide qué se puede hacer con un jugador o un equipo antes
// de tocar la base. La idea es una sola regla para el servidor y para la UI, y
// que ningún dato inválido llegue a la base (antes, un dorsal fuera de rango o
// una posición inexistente terminaban en un error 500 por la clave foránea).

import type { Player, PlayerPosition, Team } from './types.ts';

/* ============================== Límites ============================== */

/** Límites de los textos, para que la base nunca guarde basura. */
export const LIMITS = {
  teamName: 80,
  teamShortName: 4,
  teamColor: 7, // #rrggbb
  teamLogoUrl: 500,
  playerName: 80,
  playerNumberMin: 1,
  playerNumberMax: 99,
} as const;

/** Posiciones válidas (mismas que el CHECK de la tabla players). */
export const POSITIONS: PlayerPosition[] = ['', 'AR', 'DF', 'MED', 'DEL'];

const POSITION_SET: ReadonlySet<string> = new Set(POSITIONS);

/* ============================== Jugadores ============================== */

export interface PlayerInput {
  name: string;
  number: string;
  position: string;
}

/** Jugador ya normalizado, listo para guardar. */
export interface PlayerDraft {
  name: string;
  number: number | null;
  position: PlayerPosition;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Valida y normaliza un jugador desde el formulario. Reglas:
 * - el nombre es obligatorio y no puede ser solo espacios;
 * - el dorsal es opcional, pero si viene tiene que ser un entero 1–99;
 * - la posición tiene que ser una de las cuatro (o vacía).
 * Devuelve el primer error en español, o el jugador ya limpio.
 */
export function validatePlayer(input: PlayerInput): Validated<PlayerDraft> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'El nombre del jugador es obligatorio.' };
  if (name.length > LIMITS.playerName) {
    return { ok: false, error: `El nombre es demasiado largo (máximo ${LIMITS.playerName} caracteres).` };
  }

  const rawNumber = input.number.trim();
  let number: number | null = null;
  if (rawNumber) {
    if (!/^\d{1,3}$/.test(rawNumber)) {
      return { ok: false, error: 'El dorsal tiene que ser un número entero.' };
    }
    number = Number(rawNumber);
    if (number < LIMITS.playerNumberMin || number > LIMITS.playerNumberMax) {
      return {
        ok: false,
        error: `El dorsal tiene que estar entre ${LIMITS.playerNumberMin} y ${LIMITS.playerNumberMax}.`,
      };
    }
  }

  const position = input.position.trim();
  if (!POSITION_SET.has(position)) {
    return { ok: false, error: 'La posición no es válida.' };
  }

  return { ok: true, value: { name, number, position: position as PlayerPosition } };
}

/**
 * Dorsales ya usados por otro jugador del mismo equipo. Un dorsal repetido
 * genera confusiones en la planilla, así que se avisa (no bloquea: puede ser
 * un dato que el usuario prefiera corregir a mano).
 */
export function duplicateNumberMessage(
  players: readonly Pick<Player, 'id' | 'number'>[],
  number: number | null,
  excludeId?: number
): string {
  if (number == null) return '';
  const clash = players.find((p) => p.id !== excludeId && p.number === number);
  return clash ? `Ojo: el dorsal ${number} ya lo tiene otro jugador de esta plantilla.` : '';
}

/**
 * Qué se puede hacer con un jugador. Con eventos (goles o tarjetas) NO se
 * borra nunca: se da de baja, para que las estadísticas no pierdan al autor.
 */
export interface PlayerUsage {
  /** Eventos (goles, tarjetas) ya cargados para el jugador. */
  events: number;
  /** Entregas de delegados que lo mencionan. */
  submissions: number;
}

export type PlayerRemoval =
  | { kind: 'delete'; message: string }
  | { kind: 'disable'; message: string };

/**
 * Decide cómo se "saca" un jugador: borrado físico si no tiene nada asociado
 * (pierde nada), baja lógica si tiene historial. Un jugador ya dado de baja se
 * puede reactivar, nunca borrar de más.
 */
export function playerRemovalPlan(p: { active: number }, usage: PlayerUsage): PlayerRemoval {
  if (usage.events > 0) {
    return {
      kind: 'disable',
      message: `Tiene ${usage.events} evento(s) cargados (goles o tarjetas): se da de baja para no perder ese historial.`,
    };
  }
  if (usage.submissions > 0) {
    return {
      kind: 'disable',
      message: `Aparece en ${usage.submissions} entrega(s) de delegado: se da de baja para no perder ese historial.`,
    };
  }
  return {
    kind: 'delete',
    message: p.active
      ? 'No tiene eventos ni entregas: se elimina de la plantilla.'
      : 'Está dado de baja y no tiene historial: se elimina de la plantilla.',
  };
}

/** Texto del aviso antes de aplicar (para el confirm del navegador). */
export function playerRemovalWarning(p: { name: string }, plan: PlayerRemoval): string {
  const head = plan.kind === 'delete' ? `¿Eliminar a ${p.name}?` : `¿Dar de baja a ${p.name}?`;
  return `${head} ${plan.message}`.trim();
}

/* ============================== Equipos ============================== */

export interface TeamInput {
  name: string;
  shortName: string;
  color: string;
  logoUrl: string;
}

/** Equipo ya normalizado, listo para guardar. */
export interface TeamDraft {
  name: string;
  shortName: string;
  color: string;
  logoUrl: string;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Valida y normaliza un equipo desde el formulario. El color se valida como
 * hexadecimal: antes se guardaba cualquier texto y terminaba en un `style`
 * roto en el escudo de todo el sitio.
 */
export function validateTeam(input: TeamInput): Validated<TeamDraft> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'El nombre del equipo es obligatorio.' };
  if (name.length > LIMITS.teamName) {
    return { ok: false, error: `El nombre es demasiado largo (máximo ${LIMITS.teamName} caracteres).` };
  }

  const shortName = input.shortName.trim().replace(/\s+/g, '').toUpperCase();
  if (shortName.length > LIMITS.teamShortName) {
    return {
      ok: false,
      error: `La abreviatura es demasiado larga (máximo ${LIMITS.teamShortName} caracteres).`,
    };
  }

  const color = input.color.trim();
  if (!HEX_COLOR.test(color)) {
    return { ok: false, error: 'El color tiene que ser un hexadecimal del tipo #22c55e.' };
  }

  const logoUrl = input.logoUrl.trim();
  if (logoUrl) {
    if (logoUrl.length > LIMITS.teamLogoUrl) {
      return { ok: false, error: 'La dirección del escudo es demasiado larga.' };
    }
    // Solo http(s) o rutas relativas: bloquea javascript: y data:, que en un
    // src/iframe son un problema de seguridad.
    if (!/^https?:\/\//i.test(logoUrl) && !logoUrl.startsWith('/')) {
      return { ok: false, error: 'El escudo tiene que ser una dirección web (http o https).' };
    }
  }

  return { ok: true, value: { name, shortName, color: color.toLowerCase(), logoUrl } };
}

/** Cuánto tiene alrededor un equipo, para decidir si se puede borrar. */
export interface TeamUsage {
  /** Partidos del equipo, en cualquier estado. */
  matches: number;
  /** Partidos ya jugados (con resultado cargado). */
  played: number;
  /** Jugadores en su plantilla (activos e inactivos). */
  players: number;
  /** Torneos en los que participa. */
  tournaments: number;
}

/**
 * Un equipo con partidos NO se borra: los partidos quedan con `SET NULL` y el
 * torneo se rompe. Un equipo recién creado y todavía sin partidos sí.
 */
export function teamDeletionPlan(usage: TeamUsage): { allowed: boolean; error: string } {
  if (usage.matches > 0) {
    const jugados = usage.played > 0 ? ` (${usage.played} ya jugados con resultado cargado)` : '';
    return {
      allowed: false,
      error:
        `Este equipo tiene ${usage.matches} partido(s) en el fixture${jugados}: no se puede eliminar, ` +
        'porque esos partidos se quedarían sin equipo. Si dejó de competir, marcalo como inactivo.',
    };
  }
  return { allowed: true, error: '' };
}

/**
 * Texto del confirm al eliminar un equipo sin partidos: qué se va a perder.
 * Con partidos no se llega acá (el plan lo bloquea), pero el resumen se
 * muestra igual en la tarjeta.
 */
export function teamDeletionWarning(team: { name: string }, usage: TeamUsage): string {
  const partes: string[] = [];
  partes.push(`${usage.players} jugador(es)`);
  if (usage.tournaments > 0) partes.push(`${usage.tournaments} torneo(s)`);
  if (usage.matches > 0) partes.push(`${usage.matches} partido(s)`);
  return `¿Eliminar el equipo ${team.name}? Se borran: ${partes.join(', ')}. Esta acción no se puede deshacer.`;
}

/** Resumen corto para mostrar en la tarjeta del equipo. */
export function teamUsageSummary(usage: TeamUsage): string {
  const bits: string[] = [];
  bits.push(`${usage.players} jugador${usage.players === 1 ? '' : 'es'}`);
  if (usage.matches > 0) bits.push(`${usage.matches} partido${usage.matches === 1 ? '' : 's'}`);
  if (usage.tournaments > 0) bits.push(`${usage.tournaments} torneo${usage.tournaments === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

/** Estado listo para guardar en la columna `active`. */
export function activeFlag(formValue: unknown, fallback: number): number {
  return formValue ? 1 : fallback;
}