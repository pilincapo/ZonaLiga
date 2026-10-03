// Usuarios propios del panel (Community Manager): credenciales individuales
// guardadas en D1. Reutiliza la cookie firmada de siempre: esto solo cambia de
// dónde sale la contraseña y qué permisos tiene cada persona.

import {
  parsePanelPermissions,
  type PanelPermission,
  type PortalPermission,
  type SportsPermission,
} from './portalAccess.ts';

/** Iteraciones de PBKDF2-SHA256. Basta para contraseñas humanas. */
const PBKDF2_ITERATIONS = 100_000;

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return new Uint8Array(bits);
}

/**
 * Guarda la contraseña como "pbkdf2:<iteraciones>:<salt>:<hash>". No se guarda
 * en claro: si la base se filtra, la contraseña no se lee directamente.
 */
export async function hashPanelPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await deriveKey(password, salt);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${toBase64(salt)}:${toBase64(derived)}`;
}

/** Compara una contraseña candidata contra el hash guardado, en tiempo regular. */
export async function verifyPanelPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64(parts[2]!);
    expected = fromBase64(parts[3]!);
  } catch {
    return false;
  }
  const derived = await deriveKey(password, salt);
  if (derived.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < derived.length; i++) diff |= derived[i]! ^ expected[i]!;
  return diff === 0;
}

/** Cuenta de usuario del panel. `id` es el identificador del token de sesión. */
export interface PanelUser {
  id: number;
  username: string;
  name: string;
  password_hash: string;
  role: 'COMMUNITY_MANAGER';
  active: number;
}

export interface PanelUserView {
  id: number;
  username: string;
  name: string;
  active: boolean;
  permissions: PanelPermission[];
}

/** Usuario por nombre de ingreso (sin distinguir mayúsculas), o null. */
export async function getPanelUserByUsername(db: D1Database, username: string): Promise<PanelUser | null> {
  const row = await db
    .prepare(
      'SELECT id, username, name, password_hash, role, active FROM admin_users WHERE username = ?1 COLLATE NOCASE'
    )
    .bind(username.trim())
    .first<PanelUser>();
  return row ?? null;
}

/** Usuario por id (el que viaja dentro de la cookie de sesión), o null. */
export async function getPanelUserById(db: D1Database, id: number): Promise<PanelUser | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await db
    .prepare('SELECT id, username, name, password_hash, role, active FROM admin_users WHERE id = ?1')
    .bind(id)
    .first<PanelUser>();
  return row ?? null;
}

/** Permisos asignados a un usuario (portal y deportivos, ya normalizados). */
export async function userPermissions(db: D1Database, userId: number): Promise<PanelPermission[]> {
  const { results } = await db
    .prepare('SELECT permission FROM admin_user_permissions WHERE user_id = ?1 ORDER BY permission')
    .bind(userId)
    .all<{ permission: string }>();
  return parsePanelPermissions((results ?? []).map((r) => r.permission));
}

/** Permisos de portal de un usuario (para el shell de /portal-admin). */
export async function userPortalPermissions(db: D1Database, userId: number): Promise<Set<PortalPermission>> {
  const all = await userPermissions(db, userId);
  return new Set(all.filter((p): p is PortalPermission => p.startsWith('PORTAL_')));
}

/** Permisos deportivos de un usuario (para el guardia de /admin). */
export async function userSportsPermissions(db: D1Database, userId: number): Promise<SportsPermission[]> {
  const all = await userPermissions(db, userId);
  return all.filter((p): p is SportsPermission => p.startsWith('SPORTS_'));
}

/** Alta de un Community Manager con sus permisos, en una sola tanda. */
export async function createPanelUser(
  db: D1Database,
  input: { username: string; name: string; password: string; permissions: PanelPermission[] }
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const username = input.username.trim();
  if (username.length < 3) return { ok: false, error: 'El usuario necesita al menos 3 caracteres.' };
  if (input.password.length < 6) return { ok: false, error: 'La contraseña necesita al menos 6 caracteres.' };
  const clash = await getPanelUserByUsername(db, username);
  if (clash) return { ok: false, error: `Ya existe un usuario llamado "${clash.username}".` };

  const passwordHash = await hashPanelPassword(input.password);
  const insertUser = db
    .prepare(
      "INSERT INTO admin_users (username, name, password_hash, role, active) VALUES (?1, ?2, ?3, 'COMMUNITY_MANAGER', 1)"
    )
    .bind(username, input.name.trim().slice(0, 80), passwordHash);
  const insertPermissions = input.permissions.map((permission) =>
    db.prepare('INSERT OR IGNORE INTO admin_user_permissions (user_id, permission) VALUES ((SELECT id FROM admin_users WHERE username = ?1), ?2)').bind(username, permission)
  );
  const results = await db.batch([insertUser, ...insertPermissions]);
  const created = results[0]?.meta.last_row_id;
  if (!created) return { ok: false, error: 'No se pudo crear el usuario.' };
  return { ok: true, id: created };
}

/** Activa o desactiva un usuario sin borrar su historial ni sus permisos. */
export async function setPanelUserActive(db: D1Database, userId: number, active: boolean): Promise<void> {
  await db.prepare('UPDATE admin_users SET active = ?1 WHERE id = ?2').bind(active ? 1 : 0, userId).run();
}

/** Borra el usuario; sus permisos se van por cascada. */
export async function deletePanelUser(db: D1Database, userId: number): Promise<void> {
  await db.prepare('DELETE FROM admin_users WHERE id = ?1').bind(userId).run();
}

/** Reemplaza los permisos de un usuario por los indicados. */
export async function replacePanelUserPermissions(
  db: D1Database,
  userId: number,
  permissions: PanelPermission[]
): Promise<void> {
  await db.prepare('DELETE FROM admin_user_permissions WHERE user_id = ?1').bind(userId).run();
  for (const permission of permissions) {
    await db
      .prepare('INSERT OR IGNORE INTO admin_user_permissions (user_id, permission) VALUES (?1, ?2)')
      .bind(userId, permission)
      .run();
  }
}

/** Listado para la pantalla de accesos, con los permisos de cada uno. */
export async function listPanelUsers(db: D1Database): Promise<PanelUserView[]> {
  const { results } = await db
    .prepare('SELECT id, username, name, active FROM admin_users ORDER BY username COLLATE NOCASE')
    .all<{ id: number; username: string; name: string; active: number }>();
  const users: PanelUserView[] = [];
  for (const row of results ?? []) {
    users.push({
      id: row.id,
      username: row.username,
      name: row.name,
      active: row.active === 1,
      permissions: await userPermissions(db, row.id),
    });
  }
  return users;
}

/** ¿La contraseña candidata coincide con algún usuario activo? Devuelve el usuario. */
export async function authenticatePanelUser(
  db: D1Database,
  username: string,
  password: string
): Promise<PanelUser | null> {
  const user = await getPanelUserByUsername(db, username);
  if (!user || user.active !== 1) return null;
  const ok = await verifyPanelPassword(password, user.password_hash);
  return ok ? user : null;
}
