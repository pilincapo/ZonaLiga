import { describe, expect, it } from 'vitest';
import {
  PORTAL_PERMISSIONS,
  SPORTS_PERMISSIONS,
  parsePanelPermissions,
  isPortalPermission,
  permissionLabel,
  sportsPermissionForPath,
  canUseSportsDashboard,
  canAccessPortalSection,
} from '../src/lib/portalAccess.ts';

describe('permisos del panel', () => {
  it('declara exactamente los seis permisos de portal solicitados', () => {
    expect(PORTAL_PERMISSIONS).toEqual([
      'PORTAL_NOTICIAS',
      'PORTAL_FOTOS',
      'PORTAL_COMPLEJO',
      'PORTAL_TORNEO',
      'PORTAL_DESTACADOS',
      'PORTAL_CONFIGURACION',
    ]);
  });

  it('los permisos deportivos nombran secciones que ya existen, sin roles nuevos', () => {
    expect(SPORTS_PERMISSIONS).toEqual([
      'SPORTS_TORNEOS',
      'SPORTS_EQUIPOS',
      'SPORTS_FIXTURE',
      'SPORTS_RESULTADOS',
      'SPORTS_ESTADISTICAS',
      'SPORTS_DISCIPLINA',
    ]);
    expect([...PORTAL_PERMISSIONS, ...SPORTS_PERMISSIONS].every((p) => isPortalPermission(p) === p.startsWith('PORTAL_'))).toBe(true);
  });

  it('parsePanelPermissions descarta basura y duplicados del formulario', () => {
    const parsed = parsePanelPermissions(['PORTAL_NOTICIAS', 'basura', 'SPORTS_FIXTURE', 'PORTAL_NOTICIAS', undefined]);
    expect(parsed).toEqual(['PORTAL_NOTICIAS', 'SPORTS_FIXTURE']);
    expect(parsePanelPermissions([])).toEqual([]);
    expect(parsePanelPermissions(['PORTAL_*'])).toEqual([]);
  });

  it('cada ruta de /admin exige su permiso deportivo; sin permiso, cerrada', () => {
    expect(sportsPermissionForPath('/admin/torneos')).toBe('SPORTS_TORNEOS');
    expect(sportsPermissionForPath('/admin/fixture/12/editar')).toBe('SPORTS_FIXTURE');
    expect(sportsPermissionForPath('/admin/planilla/9')).toBe('SPORTS_RESULTADOS');
    expect(sportsPermissionForPath('/admin/estadisticas')).toBe('SPORTS_ESTADISTICAS');
    expect(sportsPermissionForPath('/admin/sanciones')).toBe('SPORTS_DISCIPLINA');
    // Ayuda: cualquier sesión; rutas desconocidas: cerradas por defecto.
    expect(sportsPermissionForPath('/admin/ayuda')).toBeNull();
    expect(sportsPermissionForPath('/admin/esto-no-existe')).toBeNull();
    expect(sportsPermissionForPath('/admin/accesos')).toBeNull();
  });

  it('el dashboard de /admin se abre solo con algún permiso deportivo', () => {
    expect(canUseSportsDashboard([])).toBe(false);
    expect(canUseSportsDashboard(['SPORTS_ESTADISTICAS'])).toBe(true);
  });

  it('los permisos de portal y deportivos son independientes', () => {
    const portalOnly = new Set(PORTAL_PERMISSIONS);
    expect(canAccessPortalSection({ role: 'COMMUNITY_MANAGER', userId: 1 }, 'PORTAL_NOTICIAS', portalOnly)).toBe(true);
    // Tener todo el portal no da ningún acceso deportivo.
    expect(canUseSportsDashboard([])).toBe(false);
    // Un usuario con cuenta propia no hereda nada: sin permiso no entra.
    expect(canAccessPortalSection({ role: 'COMMUNITY_MANAGER', userId: 1 }, 'PORTAL_FOTOS', new Set(['PORTAL_NOTICIAS']))).toBe(false);
    // El administrador no gestiona el portal por este camino.
    expect(canAccessPortalSection({ role: 'ADMIN' }, 'PORTAL_NOTICIAS', portalOnly)).toBe(false);
  });

  it('etiqueta los permisos para el formulario', () => {
    expect(permissionLabel('PORTAL_NOTICIAS')).toBe('NOTICIAS');
    expect(permissionLabel('SPORTS_FIXTURE')).toBe('Fixture y fechas');
  });
});
