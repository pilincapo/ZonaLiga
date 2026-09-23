// Generador de fixture round-robin (algoritmo del círculo).
// Devuelve jornadas con pares [homeId, awayId]; con impar, cada jornada tiene un "libre".
// También regenera cruces a mitad de torneo conservando lo jugado.

import type { Match } from './types.ts';
import { plannedRoundDate, roundSlots, type TournamentSchedule } from './schedule.ts';

export interface RoundPair {
  home: number;
  away: number;
}

export interface GeneratedFixture {
  rounds: RoundPair[][];
  byes: number[]; // índice de jornada => teamId libre (solo con cantidad impar)
}

/**
 * Round-robin de una vuelta. Cada equipo juega contra todos una vez.
 * teamIds se mezclan desde el caller si se quiere sorteos.
 */
export function generateRoundRobin(teamIds: number[]): GeneratedFixture {
  const ids = [...teamIds];
  if (ids.length < 2) return { rounds: [], byes: [] };

  const odd = ids.length % 2 === 1;
  if (odd) ids.push(-1); // "fantasma" = libre

  const n = ids.length; // par tras el fantasma
  const roundsCount = n - 1;
  const half = n / 2;

  const arr = [...ids]; // arr[0] fijo, el resto rota
  const rounds: RoundPair[][] = [];
  const byes: number[] = [];

  for (let r = 0; r < roundsCount; r++) {
    const pairs: RoundPair[] = [];
    for (let i = 0; i < half; i++) {
      const a = arr[i]!;
      const b = arr[n - 1 - i]!;
      if (a === -1 || b === -1) {
        byes[r] = a === -1 ? b : a;
        continue;
      }
      // Localía alternada para equilibrio.
      pairs.push(r % 2 === 0 ? { home: a, away: b } : { home: b, away: a });
    }
    rounds.push(pairs);
    // Rotación: arr[0] fijo; arr[1] pasa al final; el resto corre un lugar.
    const fixed = arr[0]!;
    const rest = arr.slice(1);
    rest.unshift(rest.pop()!);
    arr.splice(0, arr.length, fixed, ...rest);
  }

  return { rounds, byes };
}

/**
 * Round-robin de ida y vuelta: la segunda vuelta es el espejo de la primera
 * (mismo orden de cruces, localía invertida).
 */
export function generateDoubleRoundRobin(teamIds: number[]): GeneratedFixture {
  const first = generateRoundRobin(teamIds);
  const second: RoundPair[][] = first.rounds.map((pairs) => pairs.map((p) => ({ home: p.away, away: p.home })));
  const byes = [...first.byes];
  for (let i = 0; i < second.length; i++) byes.push(byes[i] ?? -1);
  return { rounds: [...first.rounds, ...second], byes };
}

/** Fisher-Yates con RNG inyectable (para tests deterministas). */
export function shuffled<T>(list: T[], rng: () => number = Math.random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/* ========== Regeneración de cruces a mitad de torneo ========== */

export type FixtureMode = 'single' | 'double';

/** Estados cuyo resultado cuenta: esas partidas son intocables. */
const LOCKED_STATUSES = new Set(['played', 'walkover']);

export interface RegenInput {
  /** Partidos actuales del torneo (todos). */
  existing: Match[];
  /** Equipos activos hoy (incluye los recién agregados). */
  activeTeamIds: number[];
  mode: FixtureMode;
  schedule: TournamentSchedule;
}

export interface NewMatch {
  round: number;
  home: number;
  away: number;
  played_on: string;
  kickoff_time: string;
  venue: string;
}

export interface RegenPlan {
  /** Partidos jugados: no se tocan. */
  keptMatchIds: number[];
  /** Partidos pendientes a borrar (events/submissions cascadan). */
  removeMatchIds: number[];
  /** Cruces nuevos, con día (el de la jornada si ya jugó alguien) y slot. */
  create: NewMatch[];
}

function pairingKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Reconstruye los cruces pendientes SIN pisar lo jugado:
 * - Conserva played/walkover con su jornada, día y resultado.
 * - Borra los pendientes y los rearma: jornadas sin partidos jugados toman
 *   el fixture fresco del círculo; jornadas mixtas arman los pares entre los
 *   equipos libres, sin repetir cruces más allá del modo (1 o 2 veces).
 * - El día nuevo es el de los jugados de esa jornada (si coinciden) o el
 *   planificado; los slots evitan cancha+hora ocupadas ese día.
 */
export function regeneratePairings(input: RegenInput): RegenPlan {
  const { existing, activeTeamIds, mode, schedule } = input;
  const allowed = mode === 'double' ? 2 : 1;

  const kept: Match[] = [];
  const remove: Match[] = [];
  for (const m of existing) (LOCKED_STATUSES.has(m.status) ? kept : remove).push(m);

  // Cruces que ya existirán: lo jugado + los pares del fixture fresco en
  // jornadas SIN partidos jugados (esas se usan tal cual). Las jornadas
  // mixtas rearman los pares greedy con este conteo, para no pasarse.
  const counts = new Map<string, number>();
  const bump = (a: number, b: number) => {
    const k = pairingKey(a, b);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  const lockedByRound = new Map<number, Match[]>();
  for (const m of kept) {
    if (m.home_team_id == null || m.away_team_id == null) continue;
    bump(m.home_team_id, m.away_team_id);
    if (m.round != null) {
      const arr = lockedByRound.get(m.round);
      if (arr) arr.push(m);
      else lockedByRound.set(m.round, [m]);
    }
  }

  const fresh =
    mode === 'double' ? generateDoubleRoundRobin(activeTeamIds) : generateRoundRobin(activeTeamIds);
  const maxRound = Math.max(
    existing.reduce((mx, m) => Math.max(mx, m.round ?? 0), 0),
    fresh.rounds.length
  );
  const active = new Set(activeTeamIds);
  const create: NewMatch[] = [];

  for (let round = 1; round <= maxRound; round++) {
    const lockedR = lockedByRound.get(round) ?? [];
    if (lockedR.length === 0 && round > fresh.rounds.length) continue; // jornada que dejó de existir
    const busy = new Set<number>();
    for (const m of lockedR) {
      if (m.home_team_id != null) busy.add(m.home_team_id);
      if (m.away_team_id != null) busy.add(m.away_team_id);
    }

    // Libres de la jornada; los pares frescos son la preferencia y el
    // greedy de menor conteo rellena. Nada se crea por encima del límite.
    const free = activeTeamIds.filter((id) => !busy.has(id));
    const used = new Set<number>();
    const pairs: RoundPair[] = [];
    const tryPair = (i: number, j: number) => {
      used.add(i);
      used.add(j);
      bump(free[i]!, free[j]!);
      pairs.push(
        round % 2 === 0 ? { home: free[j]!, away: free[i]! } : { home: free[i]!, away: free[j]! }
      );
    };

    for (const p of fresh.rounds[round - 1] ?? []) {
      const i = free.indexOf(p.home);
      const j = free.indexOf(p.away);
      if (i < 0 || j < 0 || used.has(i) || used.has(j)) continue;
      if ((counts.get(pairingKey(p.home, p.away)) ?? 0) >= allowed) continue;
      tryPair(i, j);
    }
    for (let i = 0; i < free.length; i++) {
      if (used.has(i)) continue;
      let best = -1;
      let bestCount = Infinity;
      for (let j = i + 1; j < free.length; j++) {
        if (used.has(j)) continue;
        const cnt = counts.get(pairingKey(free[i]!, free[j]!)) ?? 0;
        if (cnt < allowed && cnt < bestCount) {
          best = j;
          bestCount = cnt;
        }
      }
      if (best >= 0) tryPair(i, best); // sin pareja legal: libra esa fecha
    }

    // Día: si los jugados de la jornada coinciden en uno, el nuevo va ahí.
    const lockedDays = [...new Set(lockedR.map((m) => m.played_on).filter((d) => d))];
    const day =
      lockedR.length > 0
        ? lockedDays.length === 1
          ? lockedDays[0]!
          : plannedRoundDate(schedule, round)
        : plannedRoundDate(schedule, round);

    // Slots: los ocupados ese día por partidos jugados quedan reservados.
    const taken = new Set(
      lockedR
        .filter((m) => m.played_on === day && m.kickoff_time && m.venue)
        .map((m) => `${m.kickoff_time}|${m.venue}`)
    );
    const slots = roundSlots(lockedR.length + pairs.length, schedule);
    let cursor = 0;
    const nextSlot = (): { kickoff: string; venue: string } => {
      if (slots.length === 0) return { kickoff: '', venue: '' };
      for (let tries = 0; tries < slots.length; tries++) {
        const slot = slots[cursor % slots.length]!;
        cursor += 1;
        if (slot.kickoff && slot.venue && taken.has(`${slot.kickoff}|${slot.venue}`)) continue;
        return slot;
      }
      // Sin slots libres (config insuficiente): repite; la verificación lo avisa.
      const slot = slots[cursor % slots.length]!;
      cursor += 1;
      return slot;
    };

    for (const p of pairs) {
      if (!active.has(p.home) || !active.has(p.away)) continue;
      const slot = nextSlot();
      create.push({
        round,
        home: p.home,
        away: p.away,
        played_on: day,
        kickoff_time: slot.kickoff,
        venue: slot.venue,
      });
    }
  }

  return {
    keptMatchIds: kept.map((m) => m.id),
    removeMatchIds: remove.map((m) => m.id),
    create,
  };
}

/**
 * Verificación sobre el fixture final: choques que ningún partido nuevo debe
 * traer. Ignora los cruces de llaves (bracket), donde repetir rival es legal.
 * Devuelve mensajes en lenguaje sencillo (vacío = todo verificado).
 */
export function verifyPairings(
  matches: Match[],
  mode: FixtureMode,
  name: (id: number) => string = (id) => `equipo ${id}`
): string[] {
  const issues: string[] = [];
  const allowed = mode === 'double' ? 2 : 1;
  const league = matches.filter(
    (m) => m.round != null && !m.bracket_round && m.status !== 'bye' && m.home_team_id != null && m.away_team_id != null
  );

  // 1) Un equipo no puede jugar dos veces en la misma jornada.
  const perRoundTeam = new Map<string, { count: number; team: number; round: number }>();
  for (const m of league) {
    for (const team of [m.home_team_id!, m.away_team_id!]) {
      const k = `${m.round}:${team}`;
      const cur = perRoundTeam.get(k);
      if (cur) cur.count += 1;
      else perRoundTeam.set(k, { count: 1, team, round: m.round! });
    }
  }
  for (const v of perRoundTeam.values()) {
    if (v.count > 1) {
      issues.push(`${name(v.team)} juega ${v.count} veces en la fecha ${v.round}`);
    }
  }

  // 2) Un cruce no puede repetirse más de lo que el modo permite.
  const pairCounts = new Map<string, { n: number; a: number; b: number }>();
  for (const m of league) {
    const a = Math.min(m.home_team_id!, m.away_team_id!);
    const b = Math.max(m.home_team_id!, m.away_team_id!);
    const k = pairingKey(a, b);
    const cur = pairCounts.get(k);
    if (cur) cur.n += 1;
    else pairCounts.set(k, { n: 1, a, b });
  }
  for (const v of pairCounts.values()) {
    if (v.n > allowed) {
      issues.push(`${name(v.a)} y ${name(v.b)} se cruzan ${v.n} veces (máximo ${allowed})`);
    }
  }

  // 3) Una cancha no puede tener dos partidos el mismo día a la misma hora.
  issues.push(...slotConflicts(matches));

  return issues;
}

/** Campos mínimos para detectar un choque de cancha y hora. */
export type SlotLike = Pick<Match, 'played_on' | 'kickoff_time' | 'venue'>;

/**
 * Partidos que comparten cancha, hora y día (doble reserva). Con `inScope`
 * solo reporta grupos que incluyen un partido que lo cumple — para atribuir
 * el choque a la jornada que se está regenerando.
 */
export function slotConflicts<T extends SlotLike>(matches: T[], inScope?: (m: T) => boolean): string[] {
  const issues: string[] = [];
  const slotMap = new Map<string, T[]>();
  for (const m of matches) {
    if (!m.played_on || !m.kickoff_time || !m.venue) continue;
    const k = `${m.played_on}|${m.kickoff_time}|${m.venue}`;
    const arr = slotMap.get(k);
    if (arr) arr.push(m);
    else slotMap.set(k, [m]);
  }
  for (const [k, list] of slotMap) {
    if (list.length > 1 && (!inScope || list.some(inScope))) {
      const [day, kickoff, venue] = k.split('|');
      issues.push(`${venue} tiene ${list.length} partidos el ${day} a las ${kickoff}`);
    }
  }
  return issues;
}
