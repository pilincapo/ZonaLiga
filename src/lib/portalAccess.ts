// Permisos del panel: portal (PORTAL_*) y deportivos (SPORTS_*), por separado.
//
// No hay roles deportivos: las capacidades deportivas que ya existían en
// /admin se representan como permisos individuales, y cada sección del panel
// exige el suyo. Un Community Manager sin permisos deportivos no entra a
// /admin; con un permiso, entra solo a esa capacidad.

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

/**
 * Capacidades deportivas ya existentes de /admin, como permisos individuales.
 * No agregan funciones nuevas: nombran lo que el panel ya hacía, para poder
 * asignarlas una por una sin entregar todo el panel.
 */
export const SPORTS_PERMISSIONS = [
  'SPORTS_TORNEOS',
  'SPORTS_EQUIPOS',
  'SPORTS_FIXTURE',
  'SPORTS_RESULTADOS',
  'SPORTS_ESTADISTICAS',
  'SPORTS_DISCIPLINA',
] as const;
export type SportsPermission = (typeof SPORTS_PERMISSIONS)[number];

export type PanelPermission = PortalPermission | SportsPermission;

const ALL_PERMISSIONS = new Set<string>([...PORTAL_PERMISSIONS, ...SPORTS_PERMISSIONS]);

/** Filtra la lista cruda del formulario a permisos válidos, sin duplicados. */
export function parsePanelPermissions(raw: readonly (string | undefined)[]): PanelPermission[] {
  const out: PanelPermission[] = [];
  for (const item of raw) {
    const value = (item ?? '').trim();
    if ((ALL_PERMISSIONS as Set<string>).has(value) && !out.includes(value as PanelPermission)) {
      out.push(value as PanelPermission);
    }
  }
  return out;
}

/** ¿Es un permiso de portal? (los SPORTS_* son capacidades de /admin) */
export function isPortalPermission(p: PanelPermission): p is PortalPermission {
  return p.startsWith('PORTAL_');
}

/**
 * Sección de /admin que exige cada permiso deportivo. La ayuda (/admin/ayuda)
 * es de lectura y la ve cualquier sesión válida; todo lo que no está en esta
 * tabla queda cerrado para el Community Manager.
 */
export const SPORTS_ROUTES: Record<Exclude<SportsPermission, never>, string[]> = {
  SPORTS_TORNEOS: ['/admin/torneos'],
  SPORTS_EQUIPOS: ['/admin/equipos', '/admin/jugadores', '/admin/delegados'],
  SPORTS_FIXTURE: ['/admin/fixture', '/admin/calendario', '/admin/fechas'],
  SPORTS_RESULTADOS: ['/admin/planilla', '/admin/entregas'],
  SPORTS_ESTADISTICAS: ['/admin/estadisticas'],
  SPORTS_DISCIPLINA: ['/admin/suspensiones', '/admin/sanciones', '/admin/ajustes'],
};

/** Etiquetas para el formulario de altas (en español, sin jerga). */
export const SPORTS_PERMISSION_LABELS: Record<SportsPermission, string> = {
  SPORTS_TORNEOS: 'Torneos',
  SPORTS_EQUIPOS: 'Equipos y jugadores',
  SPORTS_FIXTURE: 'Fixture y fechas',
  SPORTS_RESULTADOS: 'Resultados y entregas',
  SPORTS_ESTADISTICAS: 'Estadísticas',
  SPORTS_DISCIPLINA: 'Disciplina (suspensiones, sanciones, puntos)',
};

export function permissionLabel(p: PanelPermission): string {
  return isPortalPermission(p) ? p.replace('PORTAL_', '') : SPORTS_PERMISSION_LABELS[p as SportsPermission];
}

/**
 * ¿Qué permiso deportivo exige esta ruta de /admin? Devuelve null para las
 * rutas que no estén en el mapa (la ayuda, y cualquier otra: cerrada por
 * defecto para el Community Manager). El dashboard de /admin no está acá: se
 * resuelve con canUseSportsDashboard(), que exige al menos un permiso.
 */
export function sportsPermissionForPath(path: string): SportsPermission | null {
  if (path === '/admin/ayuda') return null;
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  for (const [permission, prefixes] of Object.entries(SPORTS_ROUTES) as [SportsPermission, string[]][]) {
    if (prefixes.some((prefix) => clean === prefix || clean.startsWith(`${prefix}/`))) return permission;
  }
  return null;
}

/** El dashboard del /admin se muestra solo a quien tiene alguna capacidad deportiva. */
export function canUseSportsDashboard(sportsPermissions: readonly SportsPermission[]): boolean {
  return sportsPermissions.length > 0;
}

/**
 * Sesión de un usuario del panel. ADMIN es el acceso histórico por contraseña
 * única (con todos los permisos); COMMUNITY_MANAGER es un usuario real de la
 * tabla admin_users, con permisos asignados uno por uno.
 */
export interface PanelPrincipal {
  role: SessionRole;
  userId?: number;
  username?: string;
}

export function canAccessPortalSection(
  principal: PanelPrincipal,
  permission: PortalPermission,
  userPortalPermissions: ReadonlySet<PortalPermission>
): boolean {
  if (principal.role !== 'COMMUNITY_MANAGER') return false;
  return userPortalPermissions.has(permission);
}
