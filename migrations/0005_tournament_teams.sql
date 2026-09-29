-- Participación explícita equipo ↔ torneo. El equipo sigue siendo una
-- identidad global (un club, una plantilla, un delegado); esta tabla dice
-- qué equipos juegan cada torneo. PK compuesta: un equipo participa una
-- sola vez por torneo. CASCADE: borrar torneo o equipo limpia las
-- participaciones solas, igual que hoy cascadan partidos y jugadores.

CREATE TABLE tournament_teams (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (tournament_id, team_id)
);

CREATE INDEX idx_tournament_teams_team ON tournament_teams(team_id);

-- Backfill de las participaciones ya existentes, uniendo DOS fuentes:
--   (a) partidos: cada partido del torneo nombra a sus dos equipos;
--   (b) zonas: los teamIds declarados en el JSON de config del torneo.
-- INSERT OR IGNORE + PK compuesta = idempotente: re-aplicar no duplica.
-- El JOIN contra teams descarta ids que ya no existen (equipos borrados
-- que quedaron mencionados en un config viejo): no se crean filas huérfanas.
-- No toca tournaments, teams, matches ni ningún config JSON.
INSERT OR IGNORE INTO tournament_teams (tournament_id, team_id)
SELECT m.tournament_id, m.home_team_id
  FROM matches m
  JOIN teams tm ON tm.id = m.home_team_id
UNION
SELECT m.tournament_id, m.away_team_id
  FROM matches m
  JOIN teams tm ON tm.id = m.away_team_id
UNION
SELECT t.id, je.value
  FROM tournaments t,
       json_each(t.config, '$.zones.zones') z,
       json_each(z.value, '$.teamIds') je
  JOIN teams tm ON tm.id = je.value;
