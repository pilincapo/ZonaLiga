// Suspensiones: rojas directas y acumulación de amarillas según reglas del torneo.

import type { EventType, Match, Rules } from './types.ts';

export interface PlayerSuspension {
  playerId: number;
  teamId: number;
  /** Cantidad de partidos de suspensión. */
  matches: number;
  reason: string;
  /** Última jornada que provocó/compone la suspensión. */
  asOfRound: number | null;
  asOfMatchId: number;
  /** Ids de los eventos que la originan. */
  eventIds: number[];
}

export interface EventLike {
  id: number;
  match_id: number;
  player_id: number | null;
  type: EventType;
  minute: number | null;
}

/**
 * Calcula suspensiones activas al finalizar la jornada `throughRound`.
 * - Roja directa: redSuspensionMatches partidos.
 * - Amarillas: cada vez que el jugador acumula `yellowAccumulation`,
 *   queda suspendido 1 partido y el contador vuelve a cero (ventana
 *   opcional de últimas N jornadas).
 *
 * Los partidos "played"/"walkover" de rounds <= throughRound cuentan como
 * partidos de la sanción cumplida.
 */
export function computeSuspensions(
  events: EventLike[],
  matches: Match[],
  rules: Rules,
  throughRound: number
): PlayerSuspension[] {
  const matchesById = new Map(matches.map((m) => [m.id, m]));
  const roundOf = (matchId: number): number | null => {
    const m = matchesById.get(matchId);
    return m && m.status !== 'postponed' ? (m.round ?? null) : null;
  };

  const perPlayer = new Map<number, EventLike[]>();
  for (const e of events) {
    if (e.player_id == null) continue;
    if (e.type !== 'yellow' && e.type !== 'red') continue;
    const rnd = roundOf(e.match_id);
    if (rnd == null || rnd > throughRound) continue;
    const arr = perPlayer.get(e.player_id);
    if (arr) arr.push(e);
    else perPlayer.set(e.player_id, [e]);
  }

  const suspensions: PlayerSuspension[] = [];

  for (const [playerId, evts] of perPlayer) {
    evts.sort((a, b) => (roundOf(a.match_id) ?? 0) - (roundOf(b.match_id) ?? 0) || a.id - b.id);

    // Rojas directas (cada roja genera su propia sanción).
    const reds = evts.filter((e) => e.type === 'red');
    const redMatches = Math.max(0, Math.round(rules.redSuspensionMatches));
    for (const red of reds) {
      suspensions.push({
        playerId,
        teamId: teamOfEvent(red, matchesById),
        matches: redMatches,
        reason: 'Roja directa',
        asOfRound: roundOf(red.match_id),
        asOfMatchId: red.match_id,
        eventIds: [red.id],
      });
    }

    // Acumulación de amarillas (rojas no cuentan para acumulación).
    if (rules.yellowAccumulation > 0) {
      const yellows = evts.filter((e) => e.type === 'yellow');
      const window = Math.max(0, Math.round(rules.yellowAccumWindow));
      let streak: EventLike[] = [];
      for (const y of yellows) {
        if (window > 0) {
          const rnd = roundOf(y.match_id) ?? 0;
          streak = streak.filter((e) => rnd - (roundOf(e.match_id) ?? 0) < window);
        }
        streak.push(y);
        if (streak.length >= rules.yellowAccumulation) {
          suspensions.push({
            playerId,
            teamId: teamOfEvent(y, matchesById),
            matches: 1,
            reason: `${rules.yellowAccumulation} amarillas acumuladas`,
            asOfRound: roundOf(y.match_id),
            asOfMatchId: y.match_id,
            eventIds: streak.map((e) => e.id),
          });
          streak = [];
        }
      }
    }
  }

  // Consolidar por jugador: queda la sanción con mayor contenido pendiente.
  const byPlayer = new Map<number, PlayerSuspension>();
  for (const s of suspensions) {
    const prev = byPlayer.get(s.playerId);
    if (!prev || s.matches > prev.matches) byPlayer.set(s.playerId, s);
  }
  return [...byPlayer.values()].sort((a, b) => a.playerId - b.playerId);
}

function teamOfEvent(e: EventLike, matchesById: Map<number, Match>): number {
  const m = matchesById.get(e.match_id);
  return m ? ((e as { team_id?: number }).team_id ?? m.home_team_id ?? 0) : 0;
}

/**
 * Partidos restantes del torneo (round > throughRound, status scheduled)
 * donde el jugador aún estaría suspendido.
 */
export function remainingSuspensionMatches(
  suspension: PlayerSuspension,
  matches: Match[],
  throughRound: number
): Match[] {
  const servedRounds = matches
    .filter(
      (m) =>
        (m.status === 'played' || m.status === 'walkover') &&
        m.round != null &&
        m.round > throughRound &&
        m.round <= throughRound + suspension.matches
    )
    .map((m) => m.round!);
  const pending = suspension.matches - servedRounds.length;
  if (pending <= 0) return [];
  return matches
    .filter((m) => m.status === 'scheduled' && m.round != null && m.round > throughRound)
    .filter((m) => m.home_team_id === suspension.teamId || m.away_team_id === suspension.teamId)
    .slice(0, pending);
}
