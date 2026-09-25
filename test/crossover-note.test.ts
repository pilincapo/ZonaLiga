// La marca "cruce entre zonas" en notes decide cómo se trata un partido:
// no suma a la tabla de zona (salvo que la marca diga "cuenta"), no bloquea
// el playoff y la regeneración lo conserva.

import { describe, expect, it } from 'vitest';
import { CROSSOVER_NOTE, CROSSOVER_NOTE_COUNTS, isCrossoverMatch, matchesForStandings } from '../src/lib/crossover.ts';
import { isPendingLeague, pendingLeagueCount } from '../src/lib/playoff.ts';
import type { Match } from '../src/lib/types.ts';

function mk(partial: Partial<Match>): Match {
  return {
    id: 1,
    tournament_id: 1,
    round: 1,
    zone: 'A',
    bracket_round: '',
    home_team_id: 1,
    away_team_id: 2,
    home_source: '',
    away_source: '',
    played_on: '2026-10-03',
    kickoff_time: '10:00',
    venue: 'Cancha 1',
    status: 'scheduled',
    home_goals: 0,
    away_goals: 0,
    home_points: null,
    away_points: null,
    notes: '',
    ...partial,
  };
}

describe('la marca de cruce en notes', () => {
  it('reconoce el cruce por la nota', () => {
    expect(isCrossoverMatch(mk({ notes: CROSSOVER_NOTE }))).toBe(true);
    expect(isCrossoverMatch(mk({ notes: CROSSOVER_NOTE_COUNTS }))).toBe(true);
    expect(isCrossoverMatch(mk({ notes: '' }))).toBe(false);
    expect(isCrossoverMatch(mk({ notes: 'otra cosa' }))).toBe(false);
  });

  it('un cruce sin marca de cuenta NO suma a la tabla, aunque viva en una fecha normal', () => {
    const config = '{}'; // sin fechas de cruce configuradas
    const lista = [
      mk({ id: 1, notes: CROSSOVER_NOTE, home_goals: 3, away_goals: 0, status: 'played' }),
      mk({ id: 2, notes: '', home_goals: 2, away_goals: 2, status: 'played' }),
    ];
    const paraTabla = matchesForStandings(lista, config);
    expect(paraTabla.map((m) => m.id)).toEqual([2]);
  });

  it('un cruce con marca (cuenta) SÍ suma a la tabla', () => {
    const lista = [
      mk({ id: 1, notes: CROSSOVER_NOTE_COUNTS, status: 'played' }),
      mk({ id: 2, notes: CROSSOVER_NOTE, status: 'played' }),
    ];
    const paraTabla = matchesForStandings(lista, '{}');
    expect(paraTabla.map((m) => m.id)).toEqual([1]);
  });

  it('sin marca, la fecha configurada como cruce sigue excluida (fixtures viejos)', () => {
    const config = JSON.stringify({ crossover: [{ round: 3, rule: 'espejo', counts: false }] });
    const lista = [mk({ id: 1, round: 3, notes: '' })];
    expect(matchesForStandings(lista, config)).toEqual([]);
  });

  it('los cruces marcados no bloquean el playoff', () => {
    const cruces = [
      mk({ id: 1, notes: CROSSOVER_NOTE, status: 'scheduled' }),
      mk({ id: 2, notes: CROSSOVER_NOTE, status: 'postponed' }),
    ];
    const zona = [mk({ id: 3, notes: '', status: 'scheduled' })];
    expect(pendingLeagueCount(cruces)).toBe(0);
    expect(isPendingLeague(zona[0]!)).toBe(true);
    expect(pendingLeagueCount([...cruces, ...zona])).toBe(1);
  });
});
