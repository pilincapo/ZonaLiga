-- Fase 17 (cierre) — ÍNDICES DE LECTURA.
--
-- Qué pasa sin esto: Cloudflare D1 cobra por FILAS ESCANEADAS, no por las que
-- devuelve. `SELECT * FROM players WHERE team_id = ?` sin índice recorre los
-- 616 jugadores de la base para devolver los 14 de un equipo: 43 veces más de
-- lo necesario. Lo mismo con los partidos de un equipo.
--
-- Medido con la base real (44 equipos, 616 jugadores, 440 partidos):
--   · /admin/equipos pasa de 4.536 a 136 filas escaneadas.
--   · /partido/:id y /equipos/:slug bajan ~25%.
--
-- Los índices también cuentan como "filas escritas" cuando se modifica la
-- tabla, pero acá la base es chica (unos cientos de filas por mes) y el límite
-- de escritura del plan gratuito son 100.000 por día: no hay riesgo.

-- Plantillas: se lee por equipo en la planilla, en las fichas y en el panel.
CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);

-- Contar los partidos de un equipo (bloqueo de borrado, tarjetas de equipo).
CREATE INDEX IF NOT EXISTS idx_matches_home ON matches(home_team_id);
CREATE INDEX IF NOT EXISTS idx_matches_away ON matches(away_team_id);

-- Historial de un jugador para decidir si se puede borrar de verdad.
CREATE INDEX IF NOT EXISTS idx_submission_events_player ON submission_events(player_id);
