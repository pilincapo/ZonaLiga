// Tests Fase 12C: reglas centralizadas de estados de la competencia
// (src/lib/status.ts). Cubre bloqueos por estado y transiciones.
import { describe, expect, it } from 'vitest';
import {
  fixtureBlockedReason,
  matchEditsBlockedReason,
  participationBlockedReason,
  statusBlocksCompetitionEdits,
  statusBlocksFixtureEdits,
  statusBlocksMatchEdits,
  statusBlocksParticipation,
  statusIsReadOnly,
  statusTransitionBlocked,
  transitionBlockedReason,
} from '../src/lib/status.ts';

const ALL = ['draft', 'registrations', 'active', 'finished', 'archived'] as const;

describe('Fase 12C: bloqueos por estado', () => {
  it('statusIsReadOnly: solo finished y archived', () => {
    expect(statusIsReadOnly('draft')).toBe(false);
    expect(statusIsReadOnly('registrations')).toBe(false);
    expect(statusIsReadOnly('active')).toBe(false);
    expect(statusIsReadOnly('finished')).toBe(true);
    expect(statusIsReadOnly('archived')).toBe(true);
    expect(statusIsReadOnly('otro')).toBe(false);
  });

  it('edición de fixture: bloqueada en activo, finalizado y archivado', () => {
    expect(statusBlocksFixtureEdits('draft')).toBe(false);
    expect(statusBlocksFixtureEdits('registrations')).toBe(false);
    expect(statusBlocksFixtureEdits('active')).toBe(true);
    expect(statusBlocksFixtureEdits('finished')).toBe(true);
    expect(statusBlocksFixtureEdits('archived')).toBe(true);
  });

  it('edición de resultados: solo bloqueada en finalizado y archivado', () => {
    for (const s of ALL) {
      expect(statusBlocksMatchEdits(s)).toBe(s === 'finished' || s === 'archived');
    }
  });

  it('participantes: editables solo en borrador e inscripciones', () => {
    expect(statusBlocksParticipation('draft')).toBe(false);
    expect(statusBlocksParticipation('registrations')).toBe(false);
    expect(statusBlocksParticipation('active')).toBe(true);
    expect(statusBlocksParticipation('finished')).toBe(true);
    expect(statusBlocksParticipation('archived')).toBe(true);
  });

  it('reglas de competencia (puntos, localía): solo bloqueadas en finalizado/archivado', () => {
    expect(statusBlocksCompetitionEdits('active')).toBe(false);
    expect(statusBlocksCompetitionEdits('finished')).toBe(true);
    expect(statusBlocksCompetitionEdits('archived')).toBe(true);
  });

  it('los mensajes de bloqueo son claros y mencionan el estado', () => {
    expect(fixtureBlockedReason('active')).toContain('en curso');
    expect(fixtureBlockedReason('finished')).toContain('finalizado');
    expect(fixtureBlockedReason('archived')).toContain('archivado');
    expect(matchEditsBlockedReason('finished')).toContain('finalizado');
    expect(matchEditsBlockedReason('archived')).toContain('archivado');
    expect(participationBlockedReason('active')).toContain('en curso');
  });
});

describe('Fase 12C: transiciones de estado', () => {
  it('avanzar en el ciclo siempre está permitido', () => {
    expect(statusTransitionBlocked('draft', 'registrations')).toBe(false);
    expect(statusTransitionBlocked('registrations', 'active')).toBe(false);
    expect(statusTransitionBlocked('active', 'finished')).toBe(false);
    expect(statusTransitionBlocked('finished', 'archived')).toBe(false);
    // Saltos hacia adelante también (ej.: de borrador directo a activo).
    expect(statusTransitionBlocked('draft', 'active')).toBe(false);
    expect(statusTransitionBlocked('draft', 'archived')).toBe(false);
  });

  it('guardar sin cambiar el estado siempre es válido', () => {
    for (const s of ALL) expect(statusTransitionBlocked(s, s)).toBe(false);
  });

  it('retroceder desde estados tempranos está permitido (corrección temprana)', () => {
    expect(statusTransitionBlocked('registrations', 'draft')).toBe(false);
    expect(statusTransitionBlocked('active', 'registrations')).toBe(false);
    expect(statusTransitionBlocked('active', 'draft')).toBe(false);
  });

  it('finalizado y archivado son terminales hacia atrás', () => {
    expect(statusTransitionBlocked('finished', 'active')).toBe(true);
    expect(statusTransitionBlocked('finished', 'registrations')).toBe(true);
    expect(statusTransitionBlocked('finished', 'draft')).toBe(true);
    expect(statusTransitionBlocked('archived', 'finished')).toBe(true);
    expect(statusTransitionBlocked('archived', 'active')).toBe(true);
    expect(statusTransitionBlocked('archived', 'draft')).toBe(true);
  });

  it('estados desconocidos se bloquean', () => {
    expect(statusTransitionBlocked('raro', 'active')).toBe(true);
    expect(statusTransitionBlocked('draft', 'raro')).toBe(true);
  });

  it('el mensaje de transición nombra ambos estados', () => {
    const msg = transitionBlockedReason('finished', 'active');
    expect(msg).toContain('Finalizado');
    expect(msg).toContain('En curso');
    expect(msg).toContain('no vuelve hacia atrás');
  });
});
