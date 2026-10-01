-- Fase 13: historial de reprogramaciones de partidos.
-- Cada fila registra qué cambió (día, hora, cancha) y por qué. El partido
-- no se toca en nada más: equipos, jornada, resultado y eventos quedan igual.
CREATE TABLE match_reschedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  old_played_on TEXT NOT NULL DEFAULT '',
  old_kickoff_time TEXT NOT NULL DEFAULT '',
  old_venue TEXT NOT NULL DEFAULT '',
  new_played_on TEXT NOT NULL DEFAULT '',
  new_kickoff_time TEXT NOT NULL DEFAULT '',
  new_venue TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_match_reschedules_match ON match_reschedules(match_id);
