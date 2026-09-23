// Programación del torneo: canchas y horarios disponibles para el fixture.
// Se guarda en el mismo JSON de configuración del torneo (columna config),
// junto a las reglas de puntuación. Dominio puro: no toca la base.

export interface TournamentSchedule {
  /** Nombres de canchas, en el orden en que se usan. Vacío = sin cancha. */
  venues: string[];
  /** Horarios de inicio (HH:MM 24h), en orden. Vacío = sin horario. */
  kickoffs: string[];
  /** Fecha de inicio del torneo (YYYY-MM-DD). Vacío = sin calendario automático. */
  startDate: string;
  /** Días de separación entre jornadas (7 = misma semana). */
  roundGapDays: number;
  /** Día de juego preferido (0=domingo … 6=sábado). null = sin preferencia. */
  playWeekday: number | null;
}

export const EMPTY_SCHEDULE: TournamentSchedule = {
  venues: [],
  kickoffs: [],
  startDate: '',
  roundGapDays: 7,
  playWeekday: null,
};

/** Etiquetas en español, indexadas como Date.getUTCDay (0=domingo). */
export const WEEKDAY_LABELS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const MAX_ITEMS = 12;
const MAX_VENUE_LEN = 60;

/** Normaliza el nombre de cancha: recorta espacios y largo. */
function normalizeVenue(v: string): string {
  return v.trim().replace(/\s+/g, ' ').slice(0, MAX_VENUE_LEN);
}

/**
 * Normaliza un horario: acepta "9", "9:30", "09:05" y devuelve "HH:MM".
 * Devuelve null si es inválido (hora 0-23, minutos 0-59).
 */
export function normalizeKickoff(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const m = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] != null ? Number(m[2]) : 0;
  if (!Number.isInteger(h) || !Number.isInteger(min) || h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Lista desde textarea: separada por líneas o comas, sin vacíos ni repetidos. */
function parseList(raw: string, normalize: (v: string) => string | null): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[\n,]+/)) {
    const v = normalize(part);
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out.slice(0, MAX_ITEMS);
}

/** Valida una fecha YYYY-MM-DD real (mes/día coherentes). Devuelve null si no. */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return s;
}

/** Días entre jornadas: entero 1–30; cualquier otra cosa da el default 7. */
function normalizeGap(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n >= 1 && n <= 30 ? n : 7;
}

/** Día de juego: '0'…'6' (0=domingo); cualquier otra cosa = sin preferencia. */
function normalizeWeekday(raw: unknown): number | null {
  const s = String(raw ?? '').trim();
  return /^[0-6]$/.test(s) ? Number(s) : null;
}

/** Lee canchas, horarios y calendario desde los campos del formulario del torneo. */
export function scheduleFromForm(form: Record<string, unknown>): TournamentSchedule {
  return {
    venues: parseList(String(form['venues'] ?? ''), normalizeVenue),
    kickoffs: parseList(String(form['kickoffs'] ?? ''), normalizeKickoff),
    startDate: normalizeDate(String(form['start_date'] ?? '')) ?? '',
    roundGapDays: normalizeGap(form['round_gap']),
    playWeekday: normalizeWeekday(form['play_weekday']),
  };
}

/** Schedule guardado en el config del torneo; tolera configs viejos o corruptos. */
export function scheduleOf(configJson: string): TournamentSchedule {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(configJson || '{}');
    if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>;
  } catch {
    return EMPTY_SCHEDULE;
  }
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_ITEMS) : [];
  return {
    venues: list(raw['venues']),
    kickoffs: list(raw['kickoffs']),
    startDate: normalizeDate(String(raw['startDate'] ?? '')) ?? '',
    roundGapDays: normalizeGap(raw['roundGapDays'] ?? 7),
    playWeekday: normalizeWeekday(raw['playWeekday']),
  };
}

/** Primer día `weekday` (0=dom…) en o después de `isoDate`. */
function nextWeekdayOnOrAfter(isoDate: string, weekday: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const diff = (weekday - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Fecha calendario de una jornada: la de inicio, avanzando `roundGapDays`
 * por jornada (fecha 1 = inicio, fecha 2 = inicio + gap, …). Si el torneo
 * tiene día de juego, cada jornada se corre al primer ese día en o después
 * del cálculo (una liga de sábados siempre cae en sábado). Vacío si el
 * torneo no tiene fecha de inicio o la ronda no existe.
 */
export function plannedRoundDate(s: TournamentSchedule, round: number): string {
  if (!s.startDate || !Number.isFinite(round) || round < 1) return '';
  const base = shiftDate(s.startDate, (Math.trunc(round) - 1) * s.roundGapDays);
  return s.playWeekday != null ? nextWeekdayOnOrAfter(base, s.playWeekday) : base;
}

/**
 * Slots de una jornada con `count` partidos: primera hora en todas las
 * canchas, después la siguiente hora, y así. Con count 0, sin canchas o sin
 * horarios no hay nada que asignar.
 */
export function roundSlots(
  count: number,
  s: TournamentSchedule
): { venue: string; kickoff: string }[] {
  if (count <= 0 || (s.venues.length === 0 && s.kickoffs.length === 0)) return [];
  const venues = s.venues.length ? s.venues : [''];
  const kickoffs = s.kickoffs.length ? s.kickoffs : [''];
  const slots: { venue: string; kickoff: string }[] = [];
  for (const kickoff of kickoffs) {
    for (const venue of venues) slots.push({ venue, kickoff });
  }
  return Array.from({ length: count }, (_, i) => slots[i % slots.length]!);
}

/** Slots por fecha que cubre la config actual. 0 = sin canchas ni horarios. */
export function scheduleCapacity(s: TournamentSchedule): number {
  if (s.venues.length === 0 && s.kickoffs.length === 0) return 0;
  return Math.max(1, s.venues.length) * Math.max(1, s.kickoffs.length);
}

export interface ScheduleGap {
  round: number;
  /** Partidos de esa fecha en el fixture. */
  needed: number;
  /** Slots por fecha que cubre la config. */
  capacity: number;
  /** Cuántos slots faltan. */
  missing: number;
}

/**
 * Fechas cuyos partidos superan los slots disponibles. Vacío si la config
 * alcanza o si el torneo no tiene canchas ni horarios (opción válida:
 * el fixture sale sin cancha, sin aviso).
 */
export function scheduleGaps(
  s: TournamentSchedule,
  rounds: { round: number; count: number }[]
): ScheduleGap[] {
  const capacity = scheduleCapacity(s);
  if (capacity === 0) return [];
  const gaps: ScheduleGap[] = [];
  for (const r of rounds) {
    if (r.count > capacity) {
      gaps.push({ round: r.round, needed: r.count, capacity, missing: r.count - capacity });
    }
  }
  return gaps.sort((a, b) => a.round - b.round);
}

/** Aviso para la UI: qué fechas no entran y cuántos slots faltan. */
export function formatScheduleGaps(gaps: ScheduleGap[]): string {
  if (gaps.length === 0) return '';
  const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
  const detail = gaps
    .map(
      (g) =>
        `fecha ${g.round}: ${plural(g.needed, 'partido', 'partidos')} — ${plural(g.missing, 'slot falta', 'slots faltan')}`
    )
    .join(' · ');
  return `Las canchas y horarios no alcanzan (${gaps[0]!.capacity} slot(s) por fecha): ${detail}. Sumá canchas u horarios en el torneo; si no, los partidos de más repiten horario.`;
}

export interface RoundMatchInput {
  id: number;
  played_on: string;
  kickoff_time: string;
  venue: string;
  status: string;
}

export interface RoundSlotUpdate {
  id: number;
  played_on: string;
  kickoff: string;
  venue: string;
}

/** Suma N días a una fecha YYYY-MM-DD (UTC, sin sorpresas de zona horaria). */
function shiftDate(isoDate: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Estado que la regeneración puede mover: no lo jugado ni los bye. */
export function isRegenerable(status: string): boolean {
  return status !== 'played' && status !== 'walkover' && status !== 'bye';
}

/**
 * Regenera los horarios y canchas de UNA jornada: corre el día `shiftDays`
 * (negativo = adelanta) y re-slotea hora y cancha agrupando por día, por el
 * catálogo completo de la config, esquivando los slots en `occupied`
 * (claves `día|hora|cancha` de otros partidos del torneo). Los ya jugados
 * (y los bye) no se tocan; sin canchas ni horarios configurados, conserva
 * los actuales. Si no queda ningún slot libre, repite y la verificación lo
 * reporta.
 */
export function regenerateRound(
  matches: RoundMatchInput[],
  s: TournamentSchedule,
  shiftDays = 0,
  occupied: ReadonlySet<string> = new Set()
): RoundSlotUpdate[] {
  const shift = Math.trunc(shiftDays);
  const pending = matches.filter((m) => isRegenerable(m.status));
  // Catálogo con todos los slots únicos de la config (horario × cancha).
  const catalog = roundSlots(scheduleCapacity(s), s);

  // Partidos agrupados por su día (tras el corrimiento): cada día reparte
  // los slots desde el principio, como si fuera una fecha propia.
  const groups = new Map<string, RoundMatchInput[]>();
  for (const m of pending) {
    const day = shift !== 0 ? shiftDate(m.played_on, shift) : m.played_on;
    const g = groups.get(day);
    if (g) g.push(m);
    else groups.set(day, [m]);
  }

  const assigned = new Map<number, { day: string; kickoff: string; venue: string }>();
  for (const [day, group] of groups) {
    const used = new Set<string>(); // slots ya asignados en este día
    let cursor = 0;
    for (const m of group) {
      if (catalog.length === 0) {
        assigned.set(m.id, { day, kickoff: m.kickoff_time, venue: m.venue });
        continue;
      }
      let slot = catalog[cursor % catalog.length]!;
      cursor += 1;
      // Esquiva ocupados por terceros ese día y ya asignados en el grupo.
      for (let tries = 0; tries < catalog.length; tries++) {
        const key = `${day}|${slot.kickoff}|${slot.venue}`;
        if (!occupied.has(key) && !used.has(key)) break;
        slot = catalog[cursor % catalog.length]!;
        cursor += 1;
      }
      used.add(`${day}|${slot.kickoff}|${slot.venue}`);
      assigned.set(m.id, { day, kickoff: slot.kickoff, venue: slot.venue });
    }
  }

  return pending.map((m) => {
    const a = assigned.get(m.id)!;
    return { id: m.id, played_on: a.day, kickoff: a.kickoff, venue: a.venue };
  });
}
