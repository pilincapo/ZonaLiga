-- Fase 17 (cierre): BITÁCORA DE CAMBIOS POR PARTIDO.
--
-- Hasta ahora lo único que guardaba historia de un partido era
-- `match_reschedules` (día/hora/cancha antes y después). Cualquier otra
-- modificación —cambiar el resultado, cambiar el estado, agregar o borrar un
-- evento, aprobar la entrega de un delegado— se pisaba sin dejar rastro.
--
-- Esta tabla registra esas modificaciones. Es de SOLO partidos: no es una
-- auditoría general del sistema (equipos, jugadores, sanciones y configuración
-- no se registran acá, a propósito).
--
-- Una fila por CAMPO que cambió, no una fila por guardado: si el administrador
-- abre la planilla y guarda sin tocar nada, no se escribe nada. Así el
-- historial queda corto y se lee bien.
--
-- `actor` es texto y no un id de usuario porque hoy el panel tiene una sola
-- contraseña y no hay usuarios: se guarda 'admin', 'delegado:<equipo>' o
-- 'sistema'. Si algún día hay varios administradores, se cambia la columna y no
-- se rompe nada de lo que ya está escrito.
--
-- `reason` va vacío por defecto y es obligatorio solo en los casos donde ya se
-- pedía motivo (reprogramar, marcar un partido como Libre).
CREATE TABLE match_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  tournament_id INTEGER NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT NOT NULL DEFAULT 'admin',
  action TEXT NOT NULL,
  field TEXT NOT NULL DEFAULT '',
  old_value TEXT NOT NULL DEFAULT '',
  new_value TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_match_changes_match ON match_changes(match_id, id DESC);