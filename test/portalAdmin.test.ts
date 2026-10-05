import { describe, expect, it } from 'vitest';
import { portalAdminPage } from '../src/ui/portalAdmin.ts';
import { PORTAL_PERMISSIONS } from '../src/lib/portalAccess.ts';

const all = new Set(PORTAL_PERMISSIONS);

describe('shell de /portal-admin', () => {
  it('muestra navegación, ver portal, cerrar sesión y avisos de placeholder', () => {
    const html = portalAdminPage('inicio', all);
    for (const text of ['Inicio', 'Noticias', 'Fotos', 'Destacados', 'El complejo', 'Información del torneo', 'Configuración', 'Ver portal', 'Cerrar sesión']) {
      expect(html).toContain(text);
    }
    expect(html).toContain('Próximamente');
    expect(html).toContain('separado de la administración deportiva');
  });

  it('solo muestra secciones permitidas y refleja el contenido de cada una', () => {
    const html = portalAdminPage('noticias', new Set(['PORTAL_NOTICIAS']));
    expect(html).toContain('href="/portal-admin/noticias"');
    expect(html).not.toContain('href="/portal-admin/fotos"');
    // Fase 18.2: Noticias ya no es un placeholder, describe su contenido real.
    expect(html).toContain('Creá, editá, publicá y destacá');
    // Una sección sin implementar conserva el aviso de próxima etapa.
    const pendiente = portalAdminPage('destacados', new Set(['PORTAL_DESTACADOS']));
    expect(pendiente).toContain('Próximamente');
    expect(pendiente).toContain('próxima etapa');
  });

  it('un usuario sin ningún permiso de portal ve el shell pero nada que administrar', () => {
    const html = portalAdminPage('inicio', new Set());
    expect(html).toContain('Inicio');
    expect(html).not.toContain('href="/portal-admin/noticias"');
    expect(html).not.toContain('href="/portal-admin/configuracion"');
  });
});
