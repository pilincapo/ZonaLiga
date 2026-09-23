import { describe, expect, it } from 'vitest';
import {
  buildLivePayload,
  leagueNow,
  matchPhase,
  minutesOfDay,
  scorersLine,
  LEAGUE_TZ,
} from '../src/lib/live.ts';
import type { Event, Match, Player, Team } from '../src/lib/types.ts';

function team(id: number, name: string): Team {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    short_name: name.slice(0, 3).toUpperCase(),
    color: '#123456',
    logo_url: '',
    active: 1,
    delegate_name: '',
    delegate_code: null,
    delegate_enabled: 0,
    created_at: '',
  } as unknown as Team;
}

function match(over: Partial<Match>): Match {
  return {
    id: 1,
    tournament_id: 1,
    round: 7,
    zone: '',
    bracket_round: '',
    home_source: '',
    away_source: '',
    home_team_id: 1,
    away_team_id: 2,
    played_on: '2026-08-16',
    kickoff_time: '10:00',
    venue: 'Cancha 1',
    status: 'scheduled',
    home_goals: 0,
    away_goals: 0,
    notes: '',
    ...over,
  } as unknown as Match;
}

const TEAMS = [team(1, 'Deportivo Almendro'), team(2, 'Estrella del Sur')];
const PLAYERS: Pick<Player, 'id' | 'name' | 'team_id'>[] = [
  { id: 10, name: 'Ledesma', team_id: 1 },
  { id: 20, name: 'Pérez', team_id: 2 },
];

describe('reloj de la liga', () => {
  it('usa la zona de la liga, no UTC', () => {
    // 00:30 UTC del 16/8 son las 21:30 del 15/8 en Argentina.
    const clock = leagueNow(new Date('2026-08-16T00:30:00Z'));
    expect(clock.date).toBe('2026-08-15');
    expect(clock.time).toBe('21:30');
    expect(clock.minutes).toBe(21 * 60 + 30);
  });

  it('respeta la medianoche', () => {
    const clock = leagueNow(new Date('2026-08-16T03:00:00Z'));
    expect(clock.date).toBe('2026-08-16');
    expect(clock.time).toBe('00:00');
    expect(clock.minutes).toBe(0);
  });

  it('acepta otra zona horaria', () => {
    const clock = leagueNow(new Date('2026-08-16T00:30:00Z'), 'UTC');
    expect(clock.date).toBe('2026-08-16');
    expect(clock.time).toBe('00:30');
  });

  it('la zona por defecto es la de la liga', () => {
    expect(LEAGUE_TZ).toBe('America/Argentina/Buenos_Aires');
  });
});

describe('minutosOfDay', () => {
  it('convierte HH:MM', () => {
    expect(minutesOfDay('10:00')).toBe(600);
    expect(minutesOfDay('21:05')).toBe(21 * 60 + 5);
    expect(minutesOfDay('00:00')).toBe(0);
    expect(minutesOfDay('10:00:00')).toBe(600);
  });

  it('devuelve null con valores inválidos', () => {
    expect(minutesOfDay('')).toBeNull();
    expect(minutesOfDay(null)).toBeNull();
    expect(minutesOfDay(undefined)).toBeNull();
    expect(minutesOfDay('25:00')).toBeNull();
    expect(minutesOfDay('10:99')).toBeNull();
    expect(minutesOfDay('a confirmar')).toBeNull();
  });
});

describe('fase del partido', () => {
  it('antes del arranque está por jugar', () => {
    expect(matchPhase(match({ kickoff_time: '16:00' }), 15 * 60)).toBe('upcoming');
  });

  it('durante la ventana está en juego', () => {
    expect(matchPhase(match({ kickoff_time: '16:00' }), 16 * 60)).toBe('playing');
    expect(matchPhase(match({ kickoff_time: '16:00' }), 17 * 60 + 49)).toBe('playing');
  });

  it('pasada la ventana queda esperando resultado', () => {
    expect(matchPhase(match({ kickoff_time: '16:00' }), 17 * 60 + 51)).toBe('awaiting');
  });

  it('con resultado oficial está terminado', () => {
    expect(matchPhase(match({ status: 'played' }), 10 * 60)).toBe('done');
    expect(matchPhase(match({ status: 'walkover' }), 10 * 60)).toBe('done');
  });

  it('postergado o suspendido no se juega', () => {
    expect(matchPhase(match({ status: 'postponed' }), 10 * 60)).toBe('off');
    expect(matchPhase(match({ status: 'suspended' }), 10 * 60)).toBe('off');
  });

  it('sin hora cargada queda por jugar', () => {
    expect(matchPhase(match({ kickoff_time: '' }), 20 * 60)).toBe('upcoming');
  });
});

describe('scorersLine', () => {
  it('formatea goles y goles en contra', () => {
    expect(
      scorersLine([
        { name: 'Ledesma', minute: 23, own: false },
        { name: 'Sosa', minute: null, own: false },
        { name: 'Pérez', minute: 77, own: true },
      ])
    ).toBe("⚽ Ledesma 23' · ⚽ Sosa · ↩ Pérez 77' (e.c.)");
  });
});

describe('payload de la fecha en vivo', () => {
  const NOW = new Date('2026-08-16T14:00:00Z'); // 11:00 en Argentina

  it('solo incluye los partidos de hoy y los ordena por hora', () => {
    const payload = buildLivePayload({
      matches: [
        match({ id: 3, played_on: '2026-08-16', kickoff_time: '17:00' }),
        match({ id: 1, played_on: '2026-08-16', kickoff_time: '10:00' }),
        match({ id: 2, played_on: '2026-08-23', kickoff_time: '10:00' }),
        match({ id: 4, played_on: '2026-08-16', kickoff_time: '' }),
      ],
      teams: TEAMS,
      players: PLAYERS,
      events: [],
      now: NOW,
    });
    expect(payload.date).toBe('2026-08-16');
    expect(payload.matches.map((m) => m.id)).toEqual([1, 3, 4]);
    expect(payload.round).toBe(7);
  });

  it('resume el estado de la fecha y cuenta goles', () => {
    const payload = buildLivePayload({
      matches: [
        match({ id: 1, kickoff_time: '09:00', status: 'played', home_goals: 3, away_goals: 2 }),
        match({ id: 2, kickoff_time: '10:00', status: 'scheduled' }), // en juego a las 11:00
        match({ id: 3, kickoff_time: '17:00' }), // por jugar
        match({ id: 4, kickoff_time: '08:00' }), // esperando resultado
        match({ id: 5, kickoff_time: '11:00', status: 'postponed' }),
      ],
      teams: TEAMS,
      players: PLAYERS,
      events: [],
      now: NOW,
    });
    expect(payload.summary).toEqual({
      total: 5,
      done: 1,
      playing: 1,
      upcoming: 1,
      awaiting: 1,
      off: 1,
      goals: 5,
    });
  });

  it('arma los goleadores de cada lado, incluido el gol en contra', () => {
    const events: Event[] = [
      { id: 1, match_id: 1, team_id: 1, player_id: 10, type: 'goal', minute: 23 },
      { id: 2, match_id: 1, team_id: 1, player_id: 10, type: 'goal', minute: 55 },
      // Gol en contra de un jugador del local: suma para la visita.
      { id: 3, match_id: 1, team_id: 1, player_id: 10, type: 'own_goal', minute: 77 },
    ];
    const payload = buildLivePayload({
      matches: [match({ id: 1, status: 'played', home_goals: 2, away_goals: 1 })],
      teams: TEAMS,
      players: PLAYERS,
      events,
      now: NOW,
    });
    const m = payload.matches[0]!;
    expect(m.phase).toBe('done');
    expect(m.home.goals).toBe(2);
    expect(m.home.scorersText).toBe("⚽ Ledesma 23' · ⚽ Ledesma 55'");
    expect(m.away.scorersText).toBe("↩ Ledesma 77' (e.c.)");
  });

  it('expone el marcador provisorio cuando hay una entrega sin aprobar', () => {
    const payload = buildLivePayload({
      matches: [match({ id: 2, kickoff_time: '10:00' })],
      teams: TEAMS,
      players: PLAYERS,
      events: [],
      provisional: new Map([[2, { home: 1, away: 0, by: 'Diego (Deportivo Almendro)', at: '2026-08-16 11:05' }]]),
      now: NOW,
    });
    const m = payload.matches[0]!;
    expect(m.home.goals).toBeNull();
    expect(m.provisional?.home).toBe(1);
    expect(m.provisional?.by).toContain('Diego');
    expect(m.phaseText).toBe('En juego');
  });

  it('ignora el provisorio si el resultado ya está oficializado', () => {
    const payload = buildLivePayload({
      matches: [match({ id: 2, status: 'played', home_goals: 1, away_goals: 1 })],
      teams: TEAMS,
      players: PLAYERS,
      events: [],
      provisional: new Map([[2, { home: 5, away: 0, by: 'X', at: '' }]]),
      now: NOW,
    });
    expect(payload.matches[0]!.provisional).toBeNull();
  });

  it('señala la próxima jornada cuando hoy no se juega', () => {
    const payload = buildLivePayload({
      matches: [
        match({ id: 1, round: 7, played_on: '2026-08-20' }),
        match({ id: 2, round: 8, played_on: '2026-08-27' }),
        // Un partido ya jugado y otro sin fecha no cuentan como próxima jornada.
        match({ id: 3, round: 6, played_on: '2026-08-09', status: 'played' }),
        match({ id: 4, round: 9, played_on: '' }),
      ],
      teams: TEAMS,
      players: PLAYERS,
      events: [],
      now: NOW,
    });
    expect(payload.matches).toEqual([]);
    expect(payload.next).toEqual({ date: '2026-08-20', round: 7 });
  });

  it('no inventa próxima jornada si el torneo terminó', () => {
    const payload = buildLivePayload({
      matches: [match({ id: 3, round: 6, played_on: '2026-08-09', status: 'played' })],
      teams: TEAMS,
      players: PLAYERS,
      events: [],
      now: NOW,
    });
    expect(payload.next).toBeNull();
  });
});
