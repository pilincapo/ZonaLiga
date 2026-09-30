-- Fase 7B: medidas disciplinarias a EQUIPOS.
-- Agrega `measure` a sanctions: qué tipo de medida recibe el afectado.
-- Valores: advertencia | perdida_puntos | suspension_fechas | suspension_dias | expulsion.
-- NULL = sanciones viejas (pre-7B): se siguen mostrando y funcionando como antes.
--
-- Mapeo con las columnas existentes (sin duplicar datos):
--   perdida_puntos      → amount = puntos a restar (1..MAX_AMOUNT)
--   suspension_fechas   → amount = fechas de suspensión (1..MAX_AMOUNT)
--   suspension_dias     → until_date = último día de suspensión (inclusive)
--   advertencia         → sin datos extra (amount/until_date quedan NULL)
--   expulsion           → sin datos extra: inhabilita al equipo en el torneo
--
-- Para equipos, `duration_kind` pasa a ser un espejo de la medida (misma
-- semántica: 'fechas' ↔ suspension_fechas, 'dias' ↔ suspension_dias,
-- 'hasta_fecha' ↔ suspension_dias con fecha fin). Los jugadores siguen con
-- duration_kind puro: no cambian.

ALTER TABLE sanctions ADD COLUMN measure TEXT;
