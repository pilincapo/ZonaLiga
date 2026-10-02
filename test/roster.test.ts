// Tests Fase 16: equipos y jugadores (src/lib/roster.ts).
// Cubre: validación de jugador (nombre, dorsal, posición), validación de
// equipo (nombre, abreviatura, color, escudo), aviso de dorsal repetido, la
// decisión baja lógica vs borrado físico, y el bloqueo de borrado de un equipo
// que tiene partidos en el fixture.
import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  POSITIONS,
  duplicateNumberMessage,
  playerRemovalPlan,
  playerRemovalWarning,
  teamDeletionPlan,
  teamDeletionWarning,
  teamUsageSummary,
  validatePlayer,
  validateTeam,
} from '../src/lib/roster.ts';

function player(over: Partial<Parameters<typeof validatePlayer>[0]> = {}) {
  return { name: 'Juan Pérez', number: '10', position: 'MED', ...over };
}

function team(over: Partial<Parameters<typeof validateTeam>[0]> = {}) {
  return { name: 'Deportivo Norte', shortName: 'nor', color: '#22c55e', logoUrl: '', ...over };
}

describe('roster: validación de jugador', () => {
  it('acepta un jugador completo y lo normaliza', () => {
    const v = validatePlayer(player({ name: '  Juan   Pérez  ' }));
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.name).toBe('Juan Pérez'); // espacios colapsados
      expect(v.value.number).toBe(10);
      expect(v.value.position).toBe('MED');
    }
  });

  it('el dorsal es opcional', () => {
    const v = validatePlayer(player({ number: '' }));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value.number).toBeNull();
    const v2 = validatePlayer(player({ number: '   ' }));
    expect(v2.ok).toBe(true);
    if (v2.ok) expect(v2.value.number).toBeNull();
  });

  it('rechaza el nombre vacío o solo espacios', () => {
    expect(validatePlayer(player({ name: '' })).ok).toBe(false);
    expect(validatePlayer(player({ name: '    ' })).ok).toBe(false);
  });

  it('rechaza el nombre demasiado largo', () => {
    const v = validatePlayer(player({ name: 'a'.repeat(LIMITS.playerName + 1) }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain('demasiado largo');
  });

  it('rechaza dorsales fuera de rango (el caso que antes daba 500)', () => {
    for (const number of ['0', '100', '500', '-3']) {
      const v = validatePlayer(player({ number }));
      expect(v.ok, `dorsal ${number} deberia rechazarse`).toBe(false);
      if (!v.ok) expect(v.error.length).toBeGreaterThan(0);
    }
    for (const number of ['1', '99']) {
      expect(validatePlayer(player({ number })).ok).toBe(true);
    }
  });

  it('rechaza dorsales no numéricos', () => {
    for (const number of ['abc', '1.5', '10a', '١٠']) {
      expect(validatePlayer(player({ number })).ok).toBe(false);
    }
  });

  it('rechaza posiciones invalidas (el otro 500)', () => {
    expect(validatePlayer(player({ position: 'ZZZ' })).ok).toBe(false);
    expect(validatePlayer(player({ position: 'goalkeeper' })).ok).toBe(false);
  });

  it('acepta todas las posiciones validas y la vacia', () => {
    for (const position of POSITIONS) {
      expect(validatePlayer(player({ position })).ok).toBe(true);
    }
  });
});

describe('roster: aviso de dorsal repetido', () => {
  const plantilla = [
    { id: 1, number: 7 },
    { id: 2, number: 9 },
  ];

  it('avisa cuando el dorsal ya lo tiene otro', () => {
    expect(duplicateNumberMessage(plantilla, 7)).toContain('7');
    expect(duplicateNumberMessage(plantilla, 9)).toContain('9');
  });

  it('no avisa con un dorsal libre o sin dorsal', () => {
    expect(duplicateNumberMessage(plantilla, 10)).toBe('');
    expect(duplicateNumberMessage(plantilla, null)).toBe('');
  });

  it('no se queja del dorsal del propio jugador al editar', () => {
    expect(duplicateNumberMessage(plantilla, 7, 1)).toBe('');
    expect(duplicateNumberMessage(plantilla, 9, 2)).toBe('');
  });
});

describe('roster: baja lógica vs borrado físico', () => {
  it('con eventos: baja lógica, nunca borrado', () => {
    const plan = playerRemovalPlan({ active: 1 }, { events: 3, submissions: 0 });
    expect(plan.kind).toBe('disable');
    expect(plan.message).toContain('evento');
    // También si ya estaba dado de baja.
    expect(playerRemovalPlan({ active: 0 }, { events: 1, submissions: 0 }).kind).toBe('disable');
  });

  it('con entregas de delegado: baja lógica (el historial no se pierde)', () => {
    expect(playerRemovalPlan({ active: 1 }, { events: 0, submissions: 2 }).kind).toBe('disable');
  });

  it('sin historial: borrado físico', () => {
    expect(playerRemovalPlan({ active: 1 }, { events: 0, submissions: 0 }).kind).toBe('delete');
    expect(playerRemovalPlan({ active: 0 }, { events: 0, submissions: 0 }).kind).toBe('delete');
  });

  it('el aviso del confirm nombra al jugador y el motivo', () => {
    const conHistorial = playerRemovalWarning({ name: 'Juan' }, playerRemovalPlan({ active: 1 }, { events: 2, submissions: 0 }));
    expect(conHistorial).toContain('Juan');
    expect(conHistorial).toContain('Dar de baja');
    const limpio = playerRemovalWarning({ name: 'Juan' }, playerRemovalPlan({ active: 1 }, { events: 0, submissions: 0 }));
    expect(limpio).toContain('Eliminar');
    expect(limpio).toContain('Juan');
  });
});

describe('roster: validación de equipo', () => {
  it('acepta un equipo completo y normaliza', () => {
    const v = validateTeam(team({ name: '  Deportivo  Norte ', shortName: ' nor ' }));
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.name).toBe('Deportivo Norte');
      expect(v.value.shortName).toBe('NOR'); // en mayúsculas, sin espacios
      expect(v.value.color).toBe('#22c55e');
    }
  });

  it('rechaza el nombre vacío', () => {
    expect(validateTeam(team({ name: '  ' })).ok).toBe(false);
  });

  it('rechaza la abreviatura demasiado larga', () => {
    const v = validateTeam(team({ shortName: 'ABCDE' }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain('abreviatura');
  });

  it('rechaza colores que no son hexadecimales (el que rompia el escudo)', () => {
    for (const color of ['no-es-un-color', 'rojo', '#fff', '#22c55', 'rgb(1,2,3)', '']) {
      expect(validateTeam(team({ color })).ok, `color ${color}`).toBe(false);
    }
    expect(validateTeam(team({ color: '#22C55E' })).ok).toBe(true);
    expect(validateTeam(team({ color: '#22c55e' })).ok).toBe(true);
  });

  it('acepta el escudo http(s) y las rutas relativas; rechaza javascript:', () => {
    expect(validateTeam(team({ logoUrl: 'https://cdn.com/escudo.png' })).ok).toBe(true);
    expect(validateTeam(team({ logoUrl: '/img/escudo.svg' })).ok).toBe(true);
    expect(validateTeam(team({ logoUrl: 'javascript:alert(1)' })).ok).toBe(false);
    expect(validateTeam(team({ logoUrl: 'data:image/png;base64,xxx' })).ok).toBe(false);
  });
});

describe('roster: borrado de equipo', () => {
  it('bloquea el borrado si tiene partidos', () => {
    const plan = teamDeletionPlan({ matches: 12, played: 4, players: 10, tournaments: 1 });
    expect(plan.allowed).toBe(false);
    expect(plan.error).toContain('12 partido(s)');
    expect(plan.error).toContain('4 ya jugados');
    expect(plan.error).toContain('inactivo'); // la salida sugerida
  });

  it('bloquea también con partidos solo pendientes', () => {
    const plan = teamDeletionPlan({ matches: 6, played: 0, players: 9, tournaments: 1 });
    expect(plan.allowed).toBe(false);
    expect(plan.error).not.toContain('ya jugados');
  });

  it('permite borrar un equipo sin partidos (con o sin plantilla)', () => {
    expect(teamDeletionPlan({ matches: 0, played: 0, players: 0, tournaments: 0 }).allowed).toBe(true);
    expect(teamDeletionPlan({ matches: 0, played: 0, players: 14, tournaments: 1 }).allowed).toBe(true);
  });

  it('el confirm lista lo que se va a perder', () => {
    const w = teamDeletionWarning({ name: 'Deportivo Norte' }, { matches: 0, played: 0, players: 12, tournaments: 2 });
    expect(w).toContain('Deportivo Norte');
    expect(w).toContain('12 jugador(es)');
    expect(w).toContain('2 torneo(s)');
    expect(w).toContain('no se puede deshacer');
  });

  it('el resumen de la tarjeta cuenta en singular y plural', () => {
    expect(teamUsageSummary({ matches: 0, played: 0, players: 1, tournaments: 0 })).toBe('1 jugador');
    expect(teamUsageSummary({ matches: 1, played: 1, players: 12, tournaments: 3 })).toBe('12 jugadores · 1 partido · 3 torneos');
    expect(teamUsageSummary({ matches: 0, played: 0, players: 0, tournaments: 0 })).toBe('0 jugadores');
  });
});
