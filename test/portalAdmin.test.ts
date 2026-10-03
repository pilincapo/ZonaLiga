import { describe, expect, it } from 'vitest';
import { portalAdminPage } from '../src/ui/portalAdmin.ts';
import { portalPermissionsOf } from '../src/lib/portalAccess.ts';

describe('shell de /portal-admin', () => {
  it('muestra navegación, ver portal, cerrar sesión y avisos de placeholder', () => {
    const html = portalAdminPage('inicio', portalPermissionsOf());
    for (const text of ['Inicio', 'Noticias', 'Fotos', 'Destacados', 'El complejo', 'Información del torneo', 'Configuración', 'Ver portal', 'Cerrar sesión']) {
      expect(html).toContain(text);
    }
    expect(html).toContain('Próximamente');
    expect(html).toContain('separado de la administración deportiva');
  });

  it('solo muestra secciones permitidas y genera una pantalla placeholder', () => {
    const html = portalAdminPage('noticias', portalPermissionsOf('PORTAL_NOTICIAS'));
    expect(html).toContain('href="/portal-admin/noticias"');
    expect(html).not.toContain('href="/portal-admin/fotos"');
    expect(html).toContain('La carga y edición de noticias estará disponible');
  });
});
