-- Sanciones disciplinarias MANUALES (tribunal/organización): no son eventos
-- ni tarjetas. Las suspensiones automáticas por tarjetas siguen calculándose
-- con computeSuspensions sobre `events` y NO se tocan acá.
--
-- Alcance: jugador o equipo (scope). Duración: por fechas y por días usan
-- `amount`; "hasta fecha" usa `until_date` (inclusive). La anulación conserva
-- el registro con su motivo (auditoría); no se borra.

CREATE TABLE sanctions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  scope TEXT NOT NULL CHECK (scope IN ('player', 'team')),
  duration_kind TEXT NOT NULL CHECK (duration_kind IN ('fechas', 'dias', 'hasta_fecha')),
  amount INTEGER,
  until_date TEXT,
  incident_date TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'activa' CHECK (status IN ('activa', 'cumplida', 'anulada')),
  annul_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sanctions_tournament ON sanctions(tournament_id, status);
CREATE INDEX idx_sanctions_player ON sanctions(player_id);
CREATE INDEX idx_sanctions_team ON sanctions(team_id);
