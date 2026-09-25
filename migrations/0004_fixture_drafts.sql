-- Borrador de fixture: plan generado pero aún no confirmado. Guarda el JSON
-- completo del plan (partidos con día, cancha y hora) más un resumen para la
-- vista previa. Hay un borrador por torneo: generarlo de nuevo lo reemplaza.
CREATE TABLE IF NOT EXISTS fixture_drafts (
  tournament_id INTEGER PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
