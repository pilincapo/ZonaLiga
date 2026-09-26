import { describe, expect, it } from 'vitest';
import { layout } from '../src/ui/components.ts';
// Vite expone el archivo como texto sin necesitar tipos de Node.
import css from '../public/css/app.css?raw';
const html = layout({ title: 'Prueba', active: 'home', nav: [{ href: '/', label: 'Inicio', match: 'home' }], body: '' });

describe('tema claro/oscuro', () => {
  it('incluye el botón y el menú de tema en la barra', () => {
    expect(html).toContain('id="themeToggle"');
    expect(html).toContain('class="theme-toggle"');
    expect(html).toContain('id="themePop"');
    expect(html).toContain('ico-sun');
    expect(html).toContain('ico-moon');
  });

  it('aplica el tema guardado antes de pintar (sin parpadeo)', () => {
    expect(html).toContain("localStorage.getItem('zl-theme')");
    // El bootstrap va en el <head>, antes de la hoja de estilos.
    expect(html.indexOf("localStorage.getItem('zl-theme')")).toBeLessThan(html.indexOf('/css/app.css'));
  });

  it('sigue al sistema cuando no hay elección manual', () => {
    expect(html).toContain("(prefers-color-scheme: dark)");
    // La elección guardada gana: solo se consulta el sistema si no hay valor manual.
    expect(html).toMatch(/manual \? saved === 'dark' : mq\.matches/);
  });

  it('reacciona en vivo a los cambios del sistema mientras está en automático', () => {
    expect(html).toContain("mq.addEventListener('change', onSystemChange)");
    expect(html).toContain("if (now === 'dark' || now === 'light') return");
  });

  it('permite fijar y volver a automático', () => {
    expect(html).toContain("localStorage.setItem('zl-theme', choice)");
    expect(html).toContain("localStorage.removeItem('zl-theme')");
    expect(html).toContain('data-theme-choice="auto"');
    expect(html).toContain('data-theme-choice="light"');
    expect(html).toContain('data-theme-choice="dark"');
  });

  it('marca la opción activa en el menú', () => {
    expect(html).toContain('role="menuitemradio"');
    expect(html).toContain("b.setAttribute('aria-checked'");
  });

  it('versiona el CSS para que el deploy no quede cacheado', () => {
    expect(html).toMatch(/href="\/css\/app\.css\?v=\d+"/);
  });

  it('el CSS define los tokens del tema oscuro', () => {
    const dark = css.slice(css.indexOf("html[data-theme='dark'] {"));
    expect(dark.length).toBeGreaterThan(0);
    for (const token of ['--bg:', '--surface:', '--border:', '--text:', '--accent:']) {
      expect(dark).toContain(token);
    }
    // La paleta oscura del dashboard: fondo casi negro, texto claro.
    expect(dark).toContain('#0a0d12');
    expect(dark).toContain('#eaf0f6');
    // Acentos de estadística definidos en ambos temas.
    for (const token of ['--st-green:', '--st-blue:', '--st-violet:', '--st-amber:']) {
      expect(css).toContain(token);
    }
  });
});
