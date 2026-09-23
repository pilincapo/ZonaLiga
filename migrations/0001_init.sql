CREATE TABLE tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  season TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT 'round_robin'
    CHECK (format IN ('round_robin','zonas_playoffs','copa')),
  config TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','finished')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  short_name TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#22c55e',
  logo_url TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  number INTEGER,
  position TEXT NOT NULL DEFAULT ''
    CHECK (position IN ('','AR','DF','MED','DEL')),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round INTEGER,
  zone TEXT NOT NULL DEFAULT '',
  bracket_round TEXT NOT NULL DEFAULT ''
    CHECK (bracket_round IN ('','R16','QF','SF','F','3P')),
  home_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  away_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  home_source TEXT NOT NULL DEFAULT '',
  away_source TEXT NOT NULL DEFAULT '',
  played_on TEXT NOT NULL DEFAULT '',
  kickoff_time TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','played','postponed','suspended','walkover','bye')),
  home_goals INTEGER NOT NULL DEFAULT 0,
  away_goals INTEGER NOT NULL DEFAULT 0,
  home_points INTEGER,
  away_points INTEGER,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_matches_tournament ON matches(tournament_id, round);
CREATE INDEX idx_matches_status ON matches(tournament_id, status);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('goal','own_goal','yellow','red')),
  minute INTEGER
);

CREATE INDEX idx_events_match ON events(match_id);
CREATE INDEX idx_events_player ON events(player_id, type);
