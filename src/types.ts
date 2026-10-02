// Tipos del entorno del Worker.

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PASSWORD?: string;
  /**
   * Segundos que se guarda en caché cada página pública (ver src/lib/cache.ts).
   * Con "0" la caché queda apagada. El objetivo es que el presupuesto diario de
   * filas leídas de D1 no se agote: el corte, cuando ocurre, es duro y tumba el
   * sitio entero.
   */
  CACHE_PUBLICA_TTL?: string;
}
