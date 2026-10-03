// Accesos de la administración del portal, separados de los permisos deportivos.

export const SESSION_ROLES = ['ADMIN', 'COMMUNITY_MANAGER'] as const;
export type SessionRole = (typeof SESSION_ROLES)[number];

export const PORTAL_PERMISSIONS = [
  'PORTAL_NOTICIAS',
  'PORTAL_FOTOS',
  'PORTAL_COMPLEJO',
  'PORTAL_TORNEO',
  'PORTAL_DESTACADOS',
  'PORTAL_CONFIGURACION',
] as const;
export type PortalPermission = (typeof PORTAL_PERMISSIONS)[number];

const PORTAL_PERMISSION_SET = new Set<string>(PORTAL_PERMISSIONS);

/**
 * Sin una lista explícita, la clave Community Manager tiene todos los permisos
 * del portal. Una lista configurada limita independientemente cada sección.
 */
export function portalPermissionsOf(raw?: string): ReadonlySet<PortalPermission> {
  if (raw === undefined || raw === '') return new Set(PORTAL_PERMISSIONS);
  return new Set(
    raw
      .split(',')
      .map((item) => item.trim())
      .filter((item): item is PortalPermission => PORTAL_PERMISSION_SET.has(item))
  );
}

export function canAccessPortalPermission(
  role: SessionRole,
  permission: PortalPermission,
  permissions: ReadonlySet<PortalPermission>
): boolean {
  return role === 'COMMUNITY_MANAGER' && permissions.has(permission);
}

/** El único permiso deportivo vigente es el acceso completo al /admin actual. */
export function canAccessSportsAdmin(role: SessionRole, communitySportsAccess?: string): boolean {
  return role === 'ADMIN' || (role === 'COMMUNITY_MANAGER' && /^(1|true|si|sí)$/i.test(communitySportsAccess?.trim() ?? ''));
}
