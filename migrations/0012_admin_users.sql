-- Fase 18.1 (corrección): USUARIOS PROPIOS del panel.
--
-- Antes el acceso "Community Manager" era una clave compartida
-- (COMMUNITY_MANAGER_PASSWORD): una sola contraseña para cualquiera, sin
-- identidad. Acá cada persona del panel pasa a ser un usuario con credenciales
-- propias, sin crear otro sistema de autenticación: la sesión sigue siendo la
-- misma cookie firmada HMAC-SHA256 de siempre.
--
-- El administrador histórico (ADMIN_PASSWORD) NO se migra acá: sigue siendo el
-- acceso de emergencia con todos los permisos, como hasta ahora.
--
-- `role` queda preparado para más roles de panel, pero hoy solo existe
-- COMMUNITY_MANAGER. No se crean roles deportivos nuevos: las capacidades
-- deportivas son PERMISOS (tabla de abajo), no roles.
CREATE TABLE admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  -- Formato "pbkdf2:<iteraciones>:<salt-b64>:<hash-b64>" (PBKDF2-SHA256).
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'COMMUNITY_MANAGER'
    CHECK (role IN ('COMMUNITY_MANAGER')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Un permiso por fila: portal (PORTAL_*) y deportivo (SPORTS_*), separados
-- por convención de nombre. Borrar el usuario borra sus permisos.
CREATE TABLE admin_user_permissions (
  user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (user_id, permission)
);

CREATE INDEX idx_admin_user_permissions_user ON admin_user_permissions(user_id);
