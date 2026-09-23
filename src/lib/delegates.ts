// Lógica de delegados: códigos de acceso, validación de entregas y comparación
// con el resultado oficial. Todo puro para poder testearlo sin base de datos.

import type { EventType, Match, MatchStatus } from './types.ts';

export type SubmissionStatus = 'played' | 'postponed' | 'suspended' | 'walkover';
export type ReviewState = 'pending' | 'approved' | 'rejected';

export interface SubmissionRow {
  id: number;
  match_id: number;
  team_id: number;
  status: SubmissionStatus;
  home_goals: number;
  away_goals: number;
  notes: string;
  review: ReviewState;
  review_note: string;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
}

export interface SubmissionEventRow {
  id: number;
  submission_id: number;
  team_id: number;
  player_id: number;
  type: EventType;
  minute: number | null;
}

/** Alfabeto sin caracteres ambiguos (nada de I, O, 0, 1). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const MAX_GOALS = 30;
const MAX_EVENTS = 40;
const MAX_NOTES = 300;

export function generateDelegateCode(length = 8, rng?: (max: number) => number): string {
  const random = rng ?? defaultRng;
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[random(CODE_ALPHABET.length)]!;
  return out;
}

function defaultRng(max: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! % max;
}

/** Normaliza lo que escribe el delegado: mayúsculas, sin espacios ni guiones. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export const SUBMITTABLE_STATUSES: SubmissionStatus[] = ['played', 'postponed', 'suspended', 'walkover'];

export const STATUS_LABELS: Record<string, string> = {
  played: 'Jugado',
  postponed: 'Postergado',
  suspended: 'Suspendido',
  walkover: 'Walkover',
};

/** Un delegado solo puede cargar partidos de su propio equipo, ya programados. */
export function canSubmitFor(match: Pick<Match, 'home_team_id' | 'away_team_id' | 'status'>, teamId: number): boolean {
  if (match.home_team_id == null || match.away_team_id == null) return false;
  if (match.status === 'bye') return false;
  return match.home_team_id === teamId || match.away_team_id === teamId;
}

export interface SubmissionValue {
  status: SubmissionStatus;
  homeGoals: number;
  awayGoals: number;
  notes: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function intField(form: FormData, name: string): number | null {
  const raw = String(form.get(name) ?? '').trim();
  if (raw === '') return 0;
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/** Valida el formulario de resultado de un delegado. */
export function parseSubmission(form: FormData): ParseResult<SubmissionValue> {
  const statusRaw = String(form.get('status') ?? 'played');
  const status = SUBMITTABLE_STATUSES.includes(statusRaw as SubmissionStatus)
    ? (statusRaw as SubmissionStatus)
    : null;
  if (!status) return { ok: false, error: 'Estado del partido inválido' };

  const homeGoals = intField(form, 'home_goals');
  const awayGoals = intField(form, 'away_goals');
  if (homeGoals === null || awayGoals === null) {
    return { ok: false, error: 'Los goles tienen que ser números enteros' };
  }
  if (homeGoals > MAX_GOALS || awayGoals > MAX_GOALS) {
    return { ok: false, error: `Los goles no pueden superar ${MAX_GOALS}` };
  }

  const notes = String(form.get('notes') ?? '').trim().slice(0, MAX_NOTES);

  if (status === 'postponed' || status === 'suspended') {
    return { ok: true, value: { status, homeGoals: 0, awayGoals: 0, notes } };
  }
  if (status === 'walkover' && homeGoals === awayGoals) {
    return { ok: false, error: 'En un walkover tiene que haber un ganador (goles distintos)' };
  }
  return { ok: true, value: { status, homeGoals, awayGoals, notes } };
}

export interface EventValue {
  type: EventType;
  playerId: number;
  minute: number | null;
}

const EVENT_TYPES: EventType[] = ['goal', 'own_goal', 'yellow', 'red'];

/** Valida un evento: el jugador tiene que ser de la plantilla del delegado. */
export function parseEvent(form: FormData, allowedPlayers: Set<number>): ParseResult<EventValue> {
  const typeRaw = String(form.get('type') ?? 'goal');
  const type = EVENT_TYPES.includes(typeRaw as EventType) ? (typeRaw as EventType) : null;
  if (!type) return { ok: false, error: 'Tipo de evento inválido' };

  const playerId = Number(form.get('player_id'));
  if (!Number.isInteger(playerId) || playerId <= 0) return { ok: false, error: 'Elegí un jugador' };
  if (!allowedPlayers.has(playerId)) return { ok: false, error: 'Ese jugador no es de tu equipo' };

  const minuteRaw = String(form.get('minute') ?? '').trim();
  let minute: number | null = null;
  if (minuteRaw !== '') {
    const m = Number(minuteRaw);
    if (!Number.isInteger(m) || m < 0 || m > 130) return { ok: false, error: 'Minuto inválido (0-130)' };
    minute = m;
  }
  return { ok: true, value: { type, playerId, minute } };
}

export function maxEvents(): number {
  return MAX_EVENTS;
}

/** ¿La entrega difiere del resultado que ya figura oficialmente? */
export function differsFromOfficial(
  sub: Pick<SubmissionRow, 'status' | 'home_goals' | 'away_goals'>,
  match: Pick<Match, 'status' | 'home_goals' | 'away_goals'>
): boolean {
  if (match.status !== sub.status) return true;
  if (sub.status === 'postponed' || sub.status === 'suspended') return false;
  return match.home_goals !== sub.home_goals || match.away_goals !== sub.away_goals;
}

/** ¿El partido ya tiene un resultado oficial publicado? */
export function hasOfficialResult(match: Pick<Match, 'status'>): boolean {
  return match.status === 'played' || match.status === 'walkover' || match.status === 'postponed' || match.status === 'suspended';
}

export function eventCounts(events: Array<Pick<SubmissionEventRow, 'type'>>): { goals: number; ownGoals: number; yellows: number; reds: number } {
  let goals = 0;
  let ownGoals = 0;
  let yellows = 0;
  let reds = 0;
  for (const e of events) {
    if (e.type === 'goal') goals += 1;
    else if (e.type === 'own_goal') ownGoals += 1;
    else if (e.type === 'yellow') yellows += 1;
    else reds += 1;
  }
  return { goals, ownGoals, yellows, reds };
}

export function reviewLabel(review: ReviewState): string {
  return review === 'pending' ? 'Pendiente de aprobación' : review === 'approved' ? 'Publicado' : 'Rechazado';
}

export function reviewBadgeClass(review: ReviewState): string {
  return review === 'pending' ? 'amber' : review === 'approved' ? 'green' : 'red';
}

/** Texto listo para WhatsApp con el código de acceso del equipo. */
export function delegateShareText(teamName: string, code: string, url: string): string {
  return `⚽ ${teamName} — Carga de resultados ZonaLiga\nEntrá a ${url}\nTu código de delegado: ${code}`;
}

export function statusFromMatch(match: Match): MatchStatus {
  return match.status;
}
