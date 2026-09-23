// Modo "fecha en vivo": lógica pura (sin DB ni HTML) para poder testearla.

import type { Event, Match, Player, Team } from './types.ts';

/** Zona horaria de la liga: define qué es "hoy" y en qué momento se juega. */
export const LEAGUE_TZ = 'America/Argentina/Buenos_Aires';

/** Duración estimada de un partido (90' + entretiempo + descuento). */
export const MATCH_WINDOW_MINUTES = 110;

export interface LeagueClock {
  /** 'YYYY-MM-DD' local de la liga. */
  date: string;
  /** Minutos transcurridos del día local (0–1439). */
  minutes: number;
  /** 'HH:MM' local. */
  time: string;
}

/** Fecha y hora "de la liga" a partir del reloj del servidor (que corre en UTC). */
export function leagueNow(now: Date = new Date(), tz: string = LEAGUE_TZ): LeagueClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  // Algunos entornos devuelven '24' para la medianoche con hour12: false.
  const hour = get('hour') === '24' ? '00' : get('hour');
  const minutes = Number(hour) * 60 + Number(get('minute'));
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes,
    time: `${hour.padStart(2, '0')}:${get('minute')}`,
  };
}

/** 'HH:MM' (o 'HH:MM:SS') a minutos del día. null si no hay hora válida. */
export function minutesOfDay(time: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((time ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * En qué punto está un partido:
 * - `done`     ya tiene resultado oficial
 * - `playing`  arrancó y todavía no pasó la ventana del partido
 * - `awaiting` la ventana terminó y el resultado no está cargado
 * - `upcoming` todavía no arrancó
 * - `off`      postergado, suspendido o libre
 */
export type LivePhase = 'done' | 'playing' | 'awaiting' | 'upcoming' | 'off';

export function matchPhase(m: Match, nowMinutes: number): LivePhase {
  if (m.status === 'played' || m.status === 'walkover') return 'done';
  if (m.status === 'postponed' || m.status === 'suspended' || m.status === 'bye') return 'off';
  const start = minutesOfDay(m.kickoff_time);
  if (start == null) return 'upcoming';
  if (nowMinutes < start) return 'upcoming';
  if (nowMinutes <= start + MATCH_WINDOW_MINUTES) return 'playing';
  return 'awaiting';
}

export interface LiveScorer {
  name: string;
  minute: number | null;
  own: boolean;
}

export interface LiveSide {
  id: number | null;
  name: string;
  short: string;
  color: string;
  logo: string;
  slug: string;
  /** Solo cuando el partido tiene resultado oficial. */
  goals: number | null;
  scorers: LiveScorer[];
  /** Línea ya formateada (la usa el HTML y el refresco por JSON). */
  scorersText: string;
}

/** Marcador que un delegado ya envió pero el administrador todavía no aprobó. */
export interface ProvisionalScore {
  home: number;
  away: number;
  by: string;
  at: string;
}

export interface LiveMatchView {
  id: number;
  phase: LivePhase;
  /** Texto del estado, listo para mostrar. */
  phaseText: string;
  /** Marcador provisorio, si hay una entrega pendiente de aprobación. */
  provisional: ProvisionalScore | null;
  status: Match['status'];
  kickoff: string;
  kickoffMinutes: number | null;
  venue: string;
  zone: string;
  round: number | null;
  home: LiveSide;
  away: LiveSide;
}

export interface LiveSummary {
  total: number;
  done: number;
  playing: number;
  upcoming: number;
  awaiting: number;
  off: number;
  goals: number;
}

export interface LiveNext {
  date: string;
  round: number | null;
}

export interface LivePayload {
  date: string;
  time: string;
  round: number | null;
  summary: LiveSummary;
  matches: LiveMatchView[];
  /** Próxima jornada con partidos: sirve cuando hoy no se juega. */
  next: LiveNext | null;
}

const EMPTY_SIDE: LiveSide = {
  id: null,
  name: 'Por definir',
  short: '···',
  color: '#94a3b8',
  logo: '',
  slug: '',
  goals: null,
  scorers: [],
  scorersText: '',
};

/** "⚽ Ledesma 23' · ↩ Pérez (e.c.)" */
export function scorersLine(scorers: LiveScorer[]): string {
  return scorers
    .map((s) => `${s.own ? '↩' : '⚽'} ${s.name}${s.minute != null ? ` ${s.minute}'` : ''}${s.own ? ' (e.c.)' : ''}`)
    .join(' · ');
}

function sideOf(
  teamId: number | null,
  teamMap: Map<number, Team>,
  goals: number | null,
  scorers: LiveScorer[]
): LiveSide {
  const base = { goals, scorers, scorersText: scorersLine(scorers) };
  if (teamId == null) return { ...EMPTY_SIDE, ...base };
  const t = teamMap.get(teamId);
  if (!t) return { ...EMPTY_SIDE, id: teamId, ...base };
  return {
    id: t.id,
    name: t.name,
    short: t.short_name || t.name.slice(0, 3).toUpperCase(),
    color: t.color,
    logo: t.logo_url ?? '',
    slug: t.slug,
    ...base,
  };
}

/** Goles de un equipo en un partido, con quién los hizo. */
function scorersFor(events: Event[], teamId: number | null, playerMap: Map<number, string>): LiveScorer[] {
  if (teamId == null) return [];
  const out: LiveScorer[] = [];
  for (const e of events) {
    if (e.type === 'goal' && e.team_id === teamId) {
      out.push({ name: playerMap.get(e.player_id ?? -1) ?? '—', minute: e.minute, own: false });
    } else if (e.type === 'own_goal' && e.team_id !== teamId) {
      // El gol en contra lo convierte un jugador del rival: suma para este equipo.
      out.push({ name: playerMap.get(e.player_id ?? -1) ?? '—', minute: e.minute, own: true });
    }
  }
  return out.sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999));
}

/**
 * Arma todo lo que necesitan la página y el endpoint de refresco.
 * Es pura: recibe las filas ya consultadas y el reloj.
 */
export function buildLivePayload(opts: {
  matches: Match[];
  teams: Team[];
  players: Pick<Player, 'id' | 'name' | 'team_id'>[];
  events: Event[];
  provisional?: Map<number, ProvisionalScore>;
  now?: Date;
  tz?: string;
}): LivePayload {
  const clock = leagueNow(opts.now ?? new Date(), opts.tz ?? LEAGUE_TZ);
  const teamMap = new Map(opts.teams.map((t) => [t.id, t]));
  const playerMap = new Map(opts.players.map((p) => [p.id, p.name]));

  const todays = opts.matches
    .filter((m) => m.played_on === clock.date && m.status !== 'bye')
    .sort(
      (a, b) =>
        (minutesOfDay(a.kickoff_time) ?? 24 * 60) - (minutesOfDay(b.kickoff_time) ?? 24 * 60) || a.id - b.id
    );

  const views: LiveMatchView[] = todays.map((m) => {
    const phase = matchPhase(m, clock.minutes);
    const official = m.status === 'played' || m.status === 'walkover';
    const evs = opts.events.filter((e) => e.match_id === m.id);
    return {
      id: m.id,
      phase,
      phaseText: phaseLabel(phase, m.kickoff_time ?? ''),
      provisional: official ? null : opts.provisional?.get(m.id) ?? null,
      status: m.status,
      kickoff: m.kickoff_time ?? '',
      kickoffMinutes: minutesOfDay(m.kickoff_time),
      venue: m.venue ?? '',
      zone: m.zone ?? '',
      round: m.round,
      home: sideOf(m.home_team_id, teamMap, official ? m.home_goals : null, official ? scorersFor(evs, m.home_team_id, playerMap) : []),
      away: sideOf(m.away_team_id, teamMap, official ? m.away_goals : null, official ? scorersFor(evs, m.away_team_id, playerMap) : []),
    };
  });

  const summary: LiveSummary = {
    total: views.length,
    done: views.filter((v) => v.phase === 'done').length,
    playing: views.filter((v) => v.phase === 'playing').length,
    upcoming: views.filter((v) => v.phase === 'upcoming').length,
    awaiting: views.filter((v) => v.phase === 'awaiting').length,
    off: views.filter((v) => v.phase === 'off').length,
    goals: views.reduce((acc, v) => acc + (v.home.goals ?? 0) + (v.away.goals ?? 0), 0),
  };

  const rounds = views.map((v) => v.round).filter((r): r is number => r != null);

  const nextDay = opts.matches
    .filter((m) => m.status !== 'bye' && m.played_on && m.played_on > clock.date)
    .sort((a, b) => (a.played_on < b.played_on ? -1 : a.played_on > b.played_on ? 1 : 0))[0];

  return {
    date: clock.date,
    time: clock.time,
    round: rounds.length > 0 ? Math.min(...rounds) : null,
    summary,
    matches: views,
    next: nextDay ? { date: nextDay.played_on, round: nextDay.round } : null,
  };
}

/** Etiqueta corta del estado de un partido en vivo. */
export function phaseLabel(phase: LivePhase, kickoff: string): string {
  switch (phase) {
    case 'done':
      return 'Final';
    case 'playing':
      return 'En juego';
    case 'awaiting':
      return 'Esperando resultado';
    case 'upcoming':
      return kickoff ? `Empieza ${kickoff}` : 'A confirmar';
    default:
      return 'No se juega';
  }
}
