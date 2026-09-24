// Generador de fixture round-robin (algoritmo del círculo).
// Devuelve jornadas con pares [homeId, awayId]; con impar, cada jornada tiene un "libre".
// También regenera cruces a mitad de torneo conservando lo jugado y arma
// fixtures por zonas con canchas compartidas e intercaladas entre zonas.

import type { Match } from './types.ts';
import { plannedRoundDate, roundSlots, scheduleCapacity, type TournamentSchedule } from './schedule.ts';
import type { ZoneConfig } from './zones.ts';
import type { CrossoverDate } from './crossover.ts';

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

/* ========== Fixture por zonas con canchas compartidas ========== */

export interface ZonedMatch {
  zone: string;
  round: number;
  home: number;
  away: number;
  kickoff_time: string;
  venue: string;
}

export interface ZonedFixture {
  /** Máximo de fechas entre las zonas (una zona de 6 termina antes que una de 10). */
  rounds: number;
  /** Fecha r => partidos de todas las zonas esa fecha, con su zona marcada. */
  byRound: ZonedMatch[][];
  /** Fechas donde alguna zona libra. */
  byes: { zone: string; round: number; teamId: number }[];
}

/**
 * Round-robin por zona: cada zona genera su calendario interno y las fechas
 * de todas las zonas se superponen por índice (fecha 1 de la A con la 1 de
 * la B). Mantiene todos los cruces dentro de la zona.
 */
export function buildZonedFixture(zones: ZoneConfig): ZonedFixture {
  const withTeams = zones.zones.filter((z) => z.teamIds.length >= 2);
  const calendars = withTeams.map((z) => ({
    zone: z.name,
    fixture: generateRoundRobin(z.teamIds),
  }));
  const rounds = calendars.reduce((mx, c) => Math.max(mx, c.fixture.rounds.length), 0);
  const byRound: ZonedMatch[][] = Array.from({ length: rounds }, () => []);
  const byes: { zone: string; round: number; teamId: number }[] = [];
  for (const { zone, fixture } of calendars) {
    for (const [i, pairs] of fixture.rounds.entries()) {
      for (const p of pairs) {
        byRound[i]!.push({ zone, round: i + 1, home: p.home, away: p.away, kickoff_time: '', venue: '' });
      }
    }
    for (const [i, teamId] of fixture.byes.entries()) {
      if (teamId > 0) byes.push({ zone, round: i + 1, teamId });
    }
  }
  return { rounds, byRound, byes };
}

/** ZonedFixture con la forma GeneratedFixture (para reutilizarlo en regeneración). */
function zonedGeneratedFixture(zf: ZonedFixture, double: boolean): GeneratedFixture {
  const toPairs = (ms: ZonedMatch[]): RoundPair[] => ms.map((m) => ({ home: m.home, away: m.away }));
  const first = zf.byRound.map(toPairs);
  const rounds = double ? [...first, ...first.map((pairs) => pairs.map((p) => ({ home: p.away, away: p.home })))] : first;
  const byes = zf.byes.map((b) => b.teamId);
  if (double) for (let i = 0; i < first.length; i++) byes.push(byes[i] ?? -1);
  return { rounds, byes };
}

/**
 * Sloteo intercalado de una fecha: recorre una sola lista de slots (todas las
 * canchas × todos los horarios) y la reparte entre los partidos de TODAS las
 * zonas — no hay turnos por zona. Ejemplo 20 equipos / 2 zonas: fecha de 10
 * partidos con 2 canchas → 10:00 A, 10:00 B, 11:00 A, 11:00 B…
 */
export function interleaveSlots(
  matches: ZonedMatch[],
  schedule: TournamentSchedule
): void {
  if (schedule.venues.length === 0 && schedule.kickoffs.length === 0) return;
  const venues = schedule.venues.length ? schedule.venues : [''];
  const kickoffs = schedule.kickoffs.length ? schedule.kickoffs : [''];
  const catalog: { venue: string; kickoff: string }[] = [];
  for (const kickoff of kickoffs) for (const venue of venues) catalog.push({ venue, kickoff });
  matches.forEach((m, i) => {
    const slot = catalog[i % catalog.length]!;
    m.kickoff_time = slot.kickoff;
    m.venue = slot.venue;
  });
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
  /** Zonas del torneo (opcional; con zonas activas los nuevos se re-slotean compartiendo canchas). */
  zones?: ZoneConfig;
  /** Fechas de cruce entre zonas: se conservan y no entran en la verificación. */
  crossovers?: CrossoverDate[];
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
  const { existing, activeTeamIds, mode, schedule, zones = { enabled: false, zones: [] } } = input;
  // Las fechas de cruce entre zonas son intocables: se tratan como jugadas
  // aunque estén pendientes (nadie las borra ni rearma).
  const crossoverRounds = new Set((input.crossovers ?? []).map((d) => d.round));
  const allowed = mode === 'double' ? 2 : 1;

  const kept: Match[] = [];
  const remove: Match[] = [];
  for (const m of existing) {
    // Fechas de cruce y partidos de llave (playoff): intocables, aunque estén
    // pendientes — la regeneración solo rearma el fixture de la fase regular.
    if (m.bracket_round || (m.round != null && crossoverRounds.has(m.round))) kept.push(m);
    else (LOCKED_STATUSES.has(m.status) ? kept : remove).push(m);
  }

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

  // Con zonas activas, el fixture fresco es el de zonas: los cruces nuevos
  // respetan la división (nadie cruza zonas) y las fechas de todas las zonas
  // se superponen por índice. Sin zonas, el círculo de siempre.
  const useZones = zones.enabled && zones.zones.length >= 2;
  const plainFresh =
    mode === 'double' ? generateDoubleRoundRobin(activeTeamIds) : generateRoundRobin(activeTeamIds);
  const fresh: GeneratedFixture = useZones
    ? zonedGeneratedFixture(buildZonedFixture(zones), mode === 'double')
    : plainFresh;
  const zoneOfTeam = new Map<number, string>();
  if (useZones) for (const z of zones.zones) for (const id of z.teamIds) zoneOfTeam.set(id, z.name);
  const maxRound = Math.max(
    existing.reduce((mx, m) => Math.max(mx, m.round ?? 0), 0),
    fresh.rounds.length
  );
  const active = new Set(activeTeamIds);
  const create: NewMatch[] = [];

  // Fechas con cruce entre zonas o llave: no se les agregan partidos nuevos.
  const bracketRounds = new Set(existing.filter((m) => m.bracket_round && m.round != null).map((m) => m.round!));

  for (let round = 1; round <= maxRound; round++) {
    if (crossoverRounds.has(round) || bracketRounds.has(round)) continue;
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
        // Con zonas: solo se emparejan equipos de la misma zona.
        if (useZones && zoneOfTeam.get(free[i]!) !== zoneOfTeam.get(free[j]!)) continue;
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

  // Canchas y horarios compartidos entre zonas: los pendientes nuevos de cada
  // día se re-slotean en una sola lista (todas las canchas × horarios), sin
  // mirar de qué zona vienen — así las zonas intercalan canchas y nunca
  // duplican horario en la misma cancha. Lo jugado queda reservado; si algo
  // no entra, la verificación lo reporta.
  if (zones.enabled && zones.zones.length >= 2) {
    const takenByDay = new Map<string, Set<string>>();
    for (const m of kept) {
      if (!m.played_on || !m.kickoff_time || !m.venue) continue;
      const set = takenByDay.get(m.played_on);
      if (set) set.add(`${m.kickoff_time}|${m.venue}`);
      else takenByDay.set(m.played_on, new Set([`${m.kickoff_time}|${m.venue}`]));
    }
    const catalog = roundSlots(scheduleCapacity(schedule), schedule);
    const byDay = new Map<string, NewMatch[]>();
    for (const m of create) {
      if (catalog.length === 0) break;
      const arr = byDay.get(m.played_on);
      if (arr) arr.push(m);
      else byDay.set(m.played_on, [m]);
    }
    for (const [day, list] of byDay) {
      // Sin calendario (played_on vacío) no hay día real que compartan:
      // queda el sloteo por jornada de antes.
      if (!day) continue;
      const taken = new Set(takenByDay.get(day) ?? []);
      let cursor = 0;
      for (const m of list) {
        let slot = catalog[cursor % catalog.length]!;
        cursor += 1;
        for (let tries = 0; tries < catalog.length; tries++) {
          if (!taken.has(`${slot.kickoff}|${slot.venue}`)) break;
          slot = catalog[cursor % catalog.length]!;
          cursor += 1;
        }
        taken.add(`${slot.kickoff}|${slot.venue}`);
        m.kickoff_time = slot.kickoff;
        m.venue = slot.venue;
      }
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
 * traer. Ignora los cruces de llaves (bracket), donde repetir rival es legal,
 * y las fechas de cruce entre zonas (ahí cruzarse es justamente el objetivo).
 * Devuelve mensajes en lenguaje sencillo (vacío = todo verificado).
 */
export function verifyPairings(
  matches: Match[],
  mode: FixtureMode,
  name: (id: number) => string = (id) => `equipo ${id}`,
  crossoverRounds: ReadonlySet<number> = new Set()
): string[] {
  const issues: string[] = [];
  const allowed = mode === 'double' ? 2 : 1;
  const league = matches.filter(
    (m) =>
      m.round != null &&
      !m.bracket_round &&
      m.status !== 'bye' &&
      m.home_team_id != null &&
      m.away_team_id != null &&
      !crossoverRounds.has(m.round)
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

/**
 * Partidos con resultado ya cargado. Mientras haya uno, "Generar" está
 * prohibido: el DELETE masivo borraría el fixture y con él los resultados.
 */
export function playedCount(matches: ReadonlyArray<{ status: string }>): number {
  return matches.filter((m) => m.status === 'played' || m.status === 'walkover').length;
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
