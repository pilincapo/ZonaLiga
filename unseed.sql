-- Borra todos los datos de la app (incluido el seed de ejemplo) y
-- reinicia los AUTOINCREMENT, para que seed.sql pueda volver a cargarse
-- con los mismos IDs.
-- Cargar con: npm run db:unseed:local  (o db:unseed:remote)

DELETE FROM events;
DELETE FROM matches;
DELETE FROM players;
DELETE FROM teams;
DELETE FROM tournaments;

DELETE FROM sqlite_sequence
WHERE name IN ('events', 'matches', 'players', 'teams', 'tournaments');
