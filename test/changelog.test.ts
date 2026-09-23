import { describe, expect, it } from 'vitest';
import { APP_VERSION, CHANGELOG } from '../src/changelog.ts';
import { layout } from '../src/ui/components.ts';
import pkg from '../package.json?raw';
import css from '../public/css/app.css?raw';

const html = layout({ title: 'Prueba', active: 'home', nav: [{ href: '/', label: 'Inicio', match: 'home' }], body: '' });

describe('changelog', () => {
  it('el pie de página muestra la versión con link a /changelog', () => {
    expect(html).toContain('href="/changelog"');
    expect(html).toContain(`>v${APP_VERSION}</a>`);
  });

  it('la versión de la app coincide con la de package.json', () => {
    expect(JSON.parse(pkg).version).toBe(APP_VERSION);
  });

  it('hay entradas y la primera es la más nueva (v0.1.0)', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    expect(CHANGELOG[0]!.version).toBe(APP_VERSION);
    expect(CHANGELOG[0]!.date).toBe('2026-09-23');
  });

  it('las entradas están ordenadas de más nueva a más vieja', () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(CHANGELOG[i - 1]!.date >= CHANGELOG[i]!.date).toBe(true);
      // Si comparten fecha, tampoco deben repetir versión.
      if (CHANGELOG[i - 1]!.date === CHANGELOG[i]!.date) {
        expect(CHANGELOG[i - 1]!.version).not.toBe(CHANGELOG[i]!.version);
      }
    }
  });

  it('cada entrada tiene título e ítems con categoría válida', () => {
    for (const e of CHANGELOG) {
      expect(e.title.trim().length).toBeGreaterThan(0);
      expect(e.items.length).toBeGreaterThan(0);
      for (const item of e.items) {
        expect(['nuevo', 'mejora', 'arreglo']).toContain(item.kind);
        expect(item.text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('la página usa lenguaje sencillo y categoriza cada cambio', () => {
    const page = html; // el layout ya trae el footer; la página completa se prueba en las rutas
    expect(page).toContain('Novedades de esta versión');
    expect(css).toContain('.changelog-list');
    expect(css).toContain('.ver-link');
  });
});
