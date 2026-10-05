import { describe, expect, it } from 'vitest';
import { portalAdminPage } from '../src/ui/portalAdmin.ts';
import { PORTAL_PERMISSIONS } from '../src/lib/portalAccess.ts';

const all = new Set(PORTAL_PERMISSIONS);

describe('shell de /portal-admin', () => {
  it('muestra navegación, ver portal y cerrar sesión', () => {
    const html = portalAdminPage('inicio', all);
    for (const text of ['Inicio', 'Noticias', 'Fotos', 'Destacados', 'El complejo', 'Información del torneo', 'Configuración', 'Ver portal', 'Cerrar sesión']) {
      expect(html).toContain(text);
    }
    expect(html).toContain('separado de la administración deportiva');
  });

  it('solo muestra secciones permitidas y refleja el contenido de cada una', () => {
    const html = portalAdminPage('noticias', new Set(['PORTAL_NOTICIAS']));
    expect(html).toContain('href="/portal-admin/noticias"');
    expect(html).not.toContain('href="/portal-admin/fotos"');
    expect(html).toContain('Creá, editá, publicá y destacá');
  });

  it('con Fase 18.3 ninguna sección del portal queda como "Próximamente"', () => {
    for (const seccion of ['inicio', 'noticias', 'fotos', 'destacados', 'complejo', 'torneo', 'configuracion'] as const) {
      const html = portalAdminPage(
        seccion,
        new Set(['PORTAL_NOTICIAS', 'PORTAL_FOTOS', 'PORTAL_DESTACADOS', 'PORTAL_COMPLEJO', 'PORTAL_TORNEO', 'PORTAL_CONFIGURACION']),
        { content: '<p>contenido</p>' }
      );
      expect(html).not.toContain('Próximamente');
      expect(html).not.toContain('próxima etapa');
    }
  });

  it('un usuario sin ningún permiso de portal ve el shell pero nada que administrar', () => {
    const html = portalAdminPage('inicio', new Set());
    expect(html).toContain('Inicio');
    expect(html).not.toContain('href="/portal-admin/noticias"');
    expect(html).not.toContain('href="/portal-admin/configuracion"');
  });
});
