-- Delegados por equipo + entregas de resultados pendientes de aprobación.

ALTER TABLE teams ADD COLUMN delegate_name TEXT NOT NULL DEFAULT '';
ALTER TABLE teams ADD COLUMN delegate_code TEXT;
ALTER TABLE teams ADD COLUMN delegate_enabled INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX idx_teams_delegate_code
  ON teams(delegate_code) WHERE delegate_code IS NOT NULL;

-- Una entrega = un resultado propuesto por el delegado de un equipo.
-- El administrador la aprueba (pasa a matches/events) o la rechaza.
CREATE TABLE submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'played'
    CHECK (status IN ('played', 'postponed', 'suspended', 'walkover')),
  home_goals INTEGER NOT NULL DEFAULT 0,
  away_goals INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  review TEXT NOT NULL DEFAULT 'pending'
    CHECK (review IN ('pending', 'approved', 'rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);

CREATE INDEX idx_submissions_pending ON submissions(review, created_at DESC);
CREATE INDEX idx_submissions_match ON submissions(match_id, team_id);

-- Goles y tarjetas que el delegado carga de SU equipo.
CREATE TABLE submission_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('goal', 'own_goal', 'yellow', 'red')),
  minute INTEGER
);

CREATE INDEX idx_submission_events ON submission_events(submission_id);
