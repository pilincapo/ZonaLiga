-- Ajustes manuales de puntos: penalizaciones a equipos y correcciones.
-- El delta puede ser negativo (penalización) o positivo (corrección);
-- el motivo queda documentado y se muestra en el sitio.
CREATE TABLE point_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_point_adjustments_tournament ON point_adjustments(tournament_id);
CREATE INDEX idx_point_adjustments_team ON point_adjustments(team_id);
