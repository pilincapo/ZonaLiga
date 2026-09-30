-- Fase 10: configuración de competencia.
--
-- La tabla tournaments tiene CHECK sobre format y status: SQLite no permite
-- modificar una restricción, así que se reconstruye la tabla conservando
-- todos los datos, índices y claves foráneas.
--
-- Formatos nuevos (los viejos siguen siendo válidos en la base para no
-- romper torneos existentes; la UI muestra su equivalente):
--   TODOS_CONTRA_TODOS   ida (equivale a round_robin viejo)
--   UNA_RUEDA            todos contra todos, solo ida
--   DOS_RUEDAS           todos contra todos, ida y vuelta
--   FASE_DE_GRUPOS       grupos, todos contra todos por grupo, sin playoffs
--   GRUPOS_PLAYOFFS      grupos + playoffs (equivale a zonas_playoffs viejo)
--   ELIMINACION_DIRECTA  copa directa (equivale a copa viejo)
--   LIGA_FASE_FINAL      liga + fase final (playoffs entre los de arriba)
--   FASE_REGULAR_PLAYOFFS liga + playoffs con clasificación general
--
-- Estados nuevos:
--   registrations → Inscripciones: cambios estructurales limitados.
--   archived      → Archivado: solo lectura.

PRAGMA foreign_keys = OFF;

CREATE TABLE tournaments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  season TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT 'round_robin'
    CHECK (format IN (
      'round_robin', 'zonas_playoffs', 'copa',
      'TODOS_CONTRA_TODOS', 'UNA_RUEDA', 'DOS_RUEDAS',
      'FASE_DE_GRUPOS', 'GRUPOS_PLAYOFFS', 'ELIMINACION_DIRECTA',
      'LIGA_FASE_FINAL', 'FASE_REGULAR_PLAYOFFS'
    )),
  config TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'registrations', 'active', 'finished', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO tournaments_new (id, name, slug, season, format, config, status, created_at)
  SELECT id, name, slug, season, format, config, status, created_at FROM tournaments;

DROP TABLE tournaments;
ALTER TABLE tournaments_new RENAME TO tournaments;

PRAGMA foreign_key_check;
PRAGMA foreign_keys = ON;
