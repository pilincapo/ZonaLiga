import { describe, expect, it } from 'vitest';
import {
  canAccessPortalPermission,
  canAccessSportsAdmin,
  PORTAL_PERMISSIONS,
  portalPermissionsOf,
} from '../src/lib/portalAccess.ts';

const all = portalPermissionsOf();

describe('acceso del portal informativo', () => {
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

  it('Community Manager recibe todos los permisos del portal por defecto, no ADMIN', () => {
    expect(all.size).toBe(6);
    expect(canAccessPortalPermission('COMMUNITY_MANAGER', 'PORTAL_NOTICIAS', all)).toBe(true);
    expect(canAccessPortalPermission('ADMIN', 'PORTAL_NOTICIAS', all)).toBe(false);
  });

  it('permite limitar los permisos del portal sin afectar los deportivos', () => {
    const onlyNews = portalPermissionsOf('PORTAL_NOTICIAS, permiso-invalido');
    expect([...onlyNews]).toEqual(['PORTAL_NOTICIAS']);
    expect(canAccessPortalPermission('COMMUNITY_MANAGER', 'PORTAL_FOTOS', onlyNews)).toBe(false);
    expect(canAccessSportsAdmin('COMMUNITY_MANAGER')).toBe(false);
    expect(canAccessSportsAdmin('COMMUNITY_MANAGER', 'true')).toBe(true);
    expect(canAccessSportsAdmin('ADMIN')).toBe(true);
  });
});
