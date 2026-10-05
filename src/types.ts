// Tipos del entorno del Worker.
//
// D1Database, Fetcher y R2Bucket vienen de los tipos globales de
// @cloudflare/workers-types (ya instalados como devDeps). No los importamos
// aquí: los declaramos igual que el resto del proyecto para mantener la
// resolución de tipos coherente.

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /**
   * Bucket de imágenes del portal. Es PRIVADO: las imágenes se sirven desde el
   * Worker en /i/{id} (ver src/routes/portalImagenes.ts), que primero comprueba
   * que el recurso padre esté publicado.
   */
  R2_PUBLIC_BUCKET?: R2Bucket;
  ADMIN_PASSWORD?: string;
  /**
   * Segundos que se guarda en caché cada página pública (ver src/lib/cache.ts).
   * Con "0" la caché queda apagada. El objetivo es que el presupuesto diario de
   * filas leídas de D1 no se agote: el corte, cuando ocurre, es duro y tumba el
   * sitio entero.
   */
  CACHE_PUBLICA_TTL?: string;
}
