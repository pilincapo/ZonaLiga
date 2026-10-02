import { describe, expect, it } from 'vitest';
import {
  HELP_CATEGORIES,
  HELP_TOPICS,
  allHelpSections,
  blockText,
  helpCategory,
  helpSection,
  helpSnippet,
  helpTopic,
  normalizeHelp,
  searchHelp,
  sectionText,
} from '../src/lib/help.ts';
import type { IconName } from '../src/ui/icons.ts';

const ICONOS: readonly string[] = [
  'search',
  'pin',
  'trophy',
  'users',
  'calendar',
  'bolt',
  'phone',
  'shield',
  'list',
  'whistle',
  'monitor',
  'clock',
  'ball',
  'home',
  'bell',
  'chart',
  'card',
];

describe('help: estructura de la guía', () => {
  it('tiene las 14 categorías del panel', () => {
    expect(HELP_CATEGORIES.map((c) => c.id)).toEqual([
      'primeros-pasos',
      'torneos',
      'competencia',
      'equipos',
      'jugadores',
      'delegados',
      'fixture',
      'partidos',
      'calendario',
      'reprogramaciones',
      'disciplina',
      'estadisticas',
      'administracion',
      'faq',
    ]);
  });

  it('cada categoría tiene ícono válido, resumen y al menos una sección', () => {
    for (const c of HELP_CATEGORIES) {
      expect(ICONOS, `ícono de ${c.id}`).toContain(c.icon);
      expect(c.summary.length, `resumen de ${c.id}`).toBeGreaterThan(10);
      expect(c.sections.length, `secciones de ${c.id}`).toBeGreaterThan(0);
    }
  });

  it('los ids de categoría y sección son únicos', () => {
    const cats = HELP_CATEGORIES.map((c) => c.id);
    expect(new Set(cats).size).toBe(cats.length);
    const secs = allHelpSections().map((x) => x.section.id);
    expect(new Set(secs).size, 'ids de sección repetidos').toBe(secs.length);
  });

  it('cada sección tiene título y contenido', () => {
    for (const { section } of allHelpSections()) {
      expect(section.title.length).toBeGreaterThan(3);
      expect(section.blocks.length, `${section.id} sin contenido`).toBeGreaterThan(0);
      for (const b of section.blocks) {
        expect(blockText(b).trim().length, `${section.id}: bloque ${b.kind} vacío`).toBeGreaterThan(0);
      }
    }
  });

  it('no hay dos secciones con el mismo título', () => {
    const titles = allHelpSections().map((x) => x.section.title);
    expect(new Set(titles).size, `títulos repetidos: ${titles.join(' | ')}`).toBe(titles.length);
  });

  it('helpCategory y helpSection encuentran por id', () => {
    expect(helpCategory('torneos')?.title).toBe('Torneos');
    expect(helpCategory('no-existe')).toBeNull();
    expect(helpSection('flujo-completo')?.category.id).toBe('primeros-pasos');
    expect(helpSection('no-existe')).toBeNull();
  });
});

describe('help: ayuda contextual', () => {
  it('cubre todas las secciones del panel que muestran ayuda', () => {
    const esperadas = [
      'admin',
      'torneos',
      'fixture',
      'fechas',
      'calendario',
      'planilla',
      'entregas',
      'equipos',
      'jugadores',
      'delegados',
      'estadisticas',
      'ajustes',
      'suspensiones',
      'ayuda',
    ];
    expect(HELP_TOPICS.map((t) => t.id).sort()).toEqual([...esperadas].sort());
  });

  it('cada ayuda explica para qué sirve, qué se puede hacer y qué se bloquea', () => {
    for (const t of HELP_TOPICS) {
      expect(t.page, `${t.id}: falta la ruta`).toMatch(/^\/admin/);
      expect(t.para.length, `${t.id}: falta la descripción`).toBeGreaterThan(20);
      expect(t.actions.length, `${t.id}: sin acciones`).toBeGreaterThan(0);
      for (const a of t.actions) expect(a.length).toBeGreaterThan(5);
    }
  });

  it('las ayudas no son todas iguales (cada pantalla tiene su texto)', () => {
    const paras = HELP_TOPICS.map((t) => t.para);
    expect(new Set(paras).size).toBe(paras.length);
  });

  it('todos los enlaces "ver en la guía" apuntan a secciones que existen', () => {
    for (const t of HELP_TOPICS) {
      for (const m of t.more) {
        const id = m.href.replace('/admin/ayuda#', '');
        expect(helpSection(id), `${t.id} enlaza a #${id} que no existe`).not.toBeNull();
      }
    }
  });

  it('helpTopic devuelve null para una sección sin ayuda', () => {
    expect(helpTopic('planilla')).not.toBeNull();
    expect(helpTopic('no-existe')).toBeNull();
  });
});

describe('help: búsqueda', () => {
  it('encuentra por palabra suelta', () => {
    const hits = searchHelp('walkover');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.sectionId === 'estados-del-partido')).toBe(true);
  });

  it('exige que estén todos los términos (AND)', () => {
    const todos = searchHelp('walkover');
    const imposible = searchHelp('walkover zzzzz');
    expect(imposible.length).toBe(0);
    expect(todos.length).toBeGreaterThan(imposible.length);
  });

  it('no le da resultados a una consulta vacía', () => {
    expect(searchHelp('')).toEqual([]);
    expect(searchHelp('   ')).toEqual([]);
    expect(searchHelp('a')).toEqual([]);
  });

  it('funciona sin acentos', () => {
    expect(normalizeHelp('Amarillas')).toBe('amarillas');
    expect(searchHelp('amarillas').length).toBeGreaterThan(0);
    expect(searchHelp('sancion').length).toBeGreaterThan(0);
  });

  it('cada resultado trae categoría, sección y un fragmento con el texto', () => {
    const hits = searchHelp('dorsal');
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(helpCategory(h.categoryId)).not.toBeNull();
      expect(helpSection(h.sectionId)).not.toBeNull();
      expect(h.snippet.length).toBeGreaterThan(10);
      expect(h.score).toBeGreaterThan(0);
    }
  });

  it('el fragmento no corta palabras por la mitad', () => {
    const texto = 'primera palabra de prueba y otra mas larga todavia para cortar';
    const snip = helpSnippet(texto, 10, 30);
    expect(snip.startsWith('…') || snip.startsWith('primera')).toBe(true);
    expect(snip).not.toMatch(/^(?!…)[a-z]+$/);
  });

  it('el texto de una sección incluye su título', () => {
    const { section } = helpSection('flujo-completo')!;
    expect(sectionText(section)).toContain(section.title);
  });
});

describe('help: no documenta funciones que no existen', () => {
  it('aclara explícitamente que "Cancelado" no es un estado del sistema', () => {
    const { section } = helpSection('que-no-existe')!;
    const texto = sectionText(section);
    expect(texto).toContain('No existe un estado de partido "Cancelado"');
  });

  it('aclara que los jugadores dados de baja pueden seguir en algunas listas', () => {
    const { section } = helpSection('baja-y-reactivacion')!;
    expect(sectionText(section)).toContain('puede seguir apareciendo');
  });

  it('documenta el límite real de los puntos manuales (30, por los penales)', () => {
    const { section } = helpSection('puntos-manuales')!;
    const texto = sectionText(section);
    expect(texto).toContain('0 a 30');
    expect(texto).toContain('penales');
  });
});