// Fase 12C: reglas de estado de la competencia, centralizadas.
//
// Estados: BORRADOR (draft) → INSCRIPCIONES (registrations) → ACTIVO
// (active) → FINALIZADO (finished) → ARCHIVADO (archived).
//
// Toda la lógica de "¿qué se puede hacer según el estado?" vive acá, para que
// rutas y UI consulten la misma fuente y los mensajes queden consistentes.
// No agrega estados nuevos: consolida los que ya existen.

import type { TournamentStatus } from './types.ts';

export type Status = TournamentStatus;

/** true si el estado es de solo lectura (no se puede modificar NADA). */
export function statusIsReadOnly(status: string): boolean {
  return status === 'finished' || status === 'archived';
}

/**
 * Bloquea la edición estructural del fixture (generar, regenerar, confirmar
 * borrador, llaves, playoff). En ACTIVO la estructura ya está en juego; en
 * FINALIZADO y ARCHIVADO es solo lectura.
 */
export function statusBlocksFixtureEdits(status: string): boolean {
  return status === 'active' || statusIsReadOnly(status);
}

/**
 * Bloquea la edición de resultados (planillas, eventos, partido suelto).
 * Solo FINALIZADO y ARCHIVADO: los resultados históricos no se tocan.
 */
export function statusBlocksMatchEdits(status: string): boolean {
  return statusIsReadOnly(status);
}

/**
 * Bloquea cambios de participantes (altas/bajas). En BORRADOR e
 * INSCRIPCIONES se puede; desde ACTIVO el plantel de la competencia queda
 * fijado.
 */
export function statusBlocksParticipation(status: string): boolean {
  return status === 'active' || statusIsReadOnly(status);
}

/**
 * Bloquea la edición de reglas de competencia ya no competitivas (puntos,
 * desempates, localía, canchas/horarios). Solo lectura en FINALIZADO y
 * ARCHIVADO (en ACTIVO siguen ajustables: son reglas en vigor, no estructura).
 */
export function statusBlocksCompetitionEdits(status: string): boolean {
  return statusIsReadOnly(status);
}

/** Mensaje para operaciones de fixture bloqueadas por estado. */
export function fixtureBlockedReason(status: string): string {
  if (status === 'active') {
    return 'El torneo está en curso: la estructura del fixture queda congelada mientras se juega.';
  }
  if (status === 'finished') {
    return 'El torneo está finalizado: es de solo lectura. Para reabrirlo cambiá el estado (solo si es imprescindible).';
  }
  return 'El torneo está archivado: es de solo lectura y no admite cambios.';
}

/** Mensaje para resultados bloqueados por estado. */
export function matchEditsBlockedReason(status: string): string {
  if (status === 'finished') {
    return 'El torneo está finalizado: los resultados son históricos y no se pueden modificar.';
  }
  return 'El torneo está archivado: no se pueden modificar resultados.';
}

/** Mensaje para participantes bloqueados por estado. */
export function participationBlockedReason(status: string): string {
  if (status === 'active') {
    return 'El torneo está en curso: los participantes quedaron fijados al empezar.';
  }
  if (status === 'finished') {
    return 'El torneo está finalizado: los participantes son históricos.';
  }
  return 'El torneo está archivado: no admite cambios de participantes.';
}

/**
 * Transición de estado. Reglas:
 * - Hacia adelante siempre permitida (draft → registrations → active →
 *   finished → archived): es el ciclo de vida natural.
 * - Corrección temprana: mientras la competencia no terminó (draft,
 *   registrations, active) se puede volver a un estado anterior.
 * - FINALIZADO y ARCHIVADO son terminales hacia atrás: de finalizado solo
 *   se puede archivar; archivado no se reabre (protege el histórico).
 */
const ORDER: Record<Status, number> = {
  draft: 0,
  registrations: 1,
  active: 2,
  finished: 3,
  archived: 4,
};

export function statusTransitionBlocked(from: string, to: string): boolean {
  const f = ORDER[from as Status];
  const t = ORDER[to as Status];
  if (f == null || t == null) return true; // estado desconocido: bloquear
  if (f === t) return false; // guardar sin cambiar el estado siempre es válido
  if (statusIsReadOnly(from)) return t < f; // de finalizado/archivado no se vuelve
  return false; // el resto: adelante y corrección temprana
}

/** Mensaje para transición bloqueada. */
export function transitionBlockedReason(from: string, to: string): string {
  const labels: Record<string, string> = {
    draft: 'Borrador',
    registrations: 'Inscripciones',
    active: 'En curso',
    finished: 'Finalizado',
    archived: 'Archivado',
  };
  return `No se puede cambiar el estado de ${labels[from] ?? from} a ${labels[to] ?? to}: el ciclo de la competencia no vuelve hacia atrás (Finalizado solo puede archivarse).`;
}
