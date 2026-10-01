// Fase 13: reprogramación de partidos.
//
// Permite cambiar día, hora y cancha de un partido, dejando registro del
// motivo. Todo lo demás queda intacto: torneo, jornada, equipos, resultado,
// eventos y los orígenes/destinos de la llave de playoffs.
//
// Dominio puro: valida y arma el plan; la ruta consulta el estado del torneo
// y del partido, y guarda.

import type { Match } from './types.ts';
import { statusIsReadOnly } from './status.ts';

export interface RescheduleInput {
  /** Partido a reprogramar. */
  match: Match;
  /** Estado actual del torneo del partido. */
  tournamentStatus: string;
  /** Nueva fecha (YYYY-MM-DD). Vacío = sin cambio. */
  playedOn: string;
  /** Nueva hora (HH:MM). Vacío = sin cambio. */
  kickoffTime: string;
  /** Nueva cancha. Vacío = sin cambio. */
  venue: string;
  /** Motivo de la reprogramación (obligatorio). */
  reason: string;
}

export type ReschedulePlan = {
  ok: true;
  playedOn: string;
  kickoffTime: string;
  venue: string;
  /** true si el cambio es solo de cancha (mismo día y hora). */
  venueOnly: boolean;
};

/** Valida y arma el plan de reprogramación. Devuelve errores en español. */
export function planReschedule(input: RescheduleInput): ReschedulePlan | { ok: false; error: string } {
  const { match, tournamentStatus } = input;

  // El partido tiene que estar pendiente: un jugado es historial.
  if (match.status === 'played' || match.status === 'walkover') {
    return { ok: false, error: 'El partido ya se jugó: su resultado no se puede reprogramar.' };
  }

  // El torneo no puede estar finalizado ni archivado (Fase 12C).
  if (statusIsReadOnly(tournamentStatus)) {
    return {
      ok: false,
      error:
        tournamentStatus === 'finished'
          ? 'El torneo está finalizado: es de solo lectura y sus partidos no se pueden reprogramar.'
          : 'El torneo está archivado: es de solo lectura y sus partidos no se pueden reprogramar.',
    };
  }

  // Motivo obligatorio (auditoría mínima, mismo criterio que las anulaciones).
  const reason = input.reason.trim();
  if (!reason) {
    return { ok: false, error: 'Contá el motivo de la reprogramación (queda registrado en el historial).' };
  }
  if (reason.length > 500) {
    return { ok: false, error: 'El motivo es demasiado largo (máximo 500 caracteres).' };
  }

  // Formato de fecha: YYYY-MM-DD cuando viene.
  const playedOn = input.playedOn.trim();
  if (playedOn && !/^\d{4}-\d{2}-\d{2}$/.test(playedOn)) {
    return { ok: false, error: 'La fecha tiene un formato inválido (esperado AAAA-MM-DD).' };
  }
  // Hora: HH:MM real (00-23 horas, 00-59 minutos) cuando viene.
  const kickoffTime = input.kickoffTime.trim();
  if (kickoffTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(kickoffTime)) {
    return { ok: false, error: 'La hora tiene un formato inválido (esperado HH:MM, 00:00 a 23:59).' };
  }

  // Al menos un dato tiene que cambiar.
  const venue = input.venue.trim();
  const dateChanged = Boolean(playedOn) && playedOn !== match.played_on;
  const timeChanged = Boolean(kickoffTime) && kickoffTime !== match.kickoff_time;
  const venueChanged = Boolean(venue) && venue !== match.venue;
  if (!dateChanged && !timeChanged && !venueChanged) {
    return { ok: false, error: 'No hay cambios: la fecha, la hora y la cancha ya son las actuales.' };
  }

  return {
    ok: true,
    playedOn: playedOn || match.played_on,
    kickoffTime: kickoffTime || match.kickoff_time,
    venue: venue || match.venue,
    venueOnly: !dateChanged && !timeChanged,
  };
}

/** Registro del historial de reprogramaciones de un partido. */
export interface RescheduleRecord {
  id: number;
  old_played_on: string;
  old_kickoff_time: string;
  old_venue: string;
  new_played_on: string;
  new_kickoff_time: string;
  new_venue: string;
  reason: string;
  created_at: string;
}

/** Formatea una fecha AAAA-MM-DD a corto local (si hay algo que mostrar). */
export function rescheduleDay(day: string): string {
  return day || 'sin fecha';
}

/** Formatea una hora HH:MM (si hay algo que mostrar). */
export function rescheduleTime(time: string): string {
  return time || 'sin hora';
}
