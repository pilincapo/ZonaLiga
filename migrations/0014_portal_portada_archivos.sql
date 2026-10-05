-- Fase 18.3 — Portada del portal y archivos (R2 con compatibilidad URL externa).
--
-- Qué guarda esto:
--   · portal_portada: qué noticia va como hero y qué noticias/galerías salen
--     destacadas en la portada. Una sola fila (portada_id = 1): el proyecto no
--     tiene multi-organización ni multi-portal.
--   · portal_archivos: metadatos de las imágenes (subidas a R2 o enlazadas por
--     URL externa). El binario NUNCA va a D1; acá solo datos y la clave del
--     objeto. `url_publico` es siempre la dirección que se sirve: si el archivo
--     es externo coincide con `url_externo`; si es de R2, es la URL del bucket.
--   · portal_configuracion: datos públicos del portal (nombre, descripción,
--     contacto, redes, pie) con su propio estado de publicación, para que la
--     configuración no se mezcle con las páginas de contenido.

-- ------------------------------ portada ------------------------------

CREATE TABLE portal_portada (
  portada_id         INTEGER PRIMARY KEY CHECK (portada_id = 1),
  noticia_hero_id    INTEGER REFERENCES portal_noticias(id) ON DELETE SET NULL,
  noticias_destacadas TEXT CHECK (noticias_destacadas IS NULL OR json_valid(noticias_destacadas)),
  galerias_destacadas TEXT CHECK (galerias_destacadas IS NULL OR json_valid(galerias_destacadas)),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO portal_portada (portada_id) VALUES (1);

-- La regla "el hero tiene que estar publicado" NO se puede poner como CHECK
-- (SQLite no permite subconsultas ahí), así que se valida al escribir: el
-- servicio /i/{id} y la lectura de la portada igual filtran por publicado.

-- ------------------------------ archivos -----------------------------

CREATE TABLE portal_archivos (
  archivo_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo             TEXT NOT NULL,
  padre_id         INTEGER NOT NULL,
  nombre_seguridad TEXT NOT NULL,
  extension        TEXT NOT NULL CHECK (extension = lower(extension)),
  mime             TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  tamano_bytes     INTEGER NOT NULL CHECK (tamano_bytes >= 0),
  url_externo      TEXT,
  key_r2           TEXT,
  url_publico      TEXT NOT NULL,
  es_publico       INTEGER NOT NULL DEFAULT 0 CHECK (es_publico IN (0, 1)),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  -- Exactamente una de las dos fuentes: enlace externo o objeto en R2.
  CHECK (
    (url_externo IS NOT NULL AND key_r2 IS NULL AND url_publico = url_externo)
    OR
    (url_externo IS NULL AND key_r2 IS NOT NULL)
  )
);

-- Un archivo por tipo y padre (imagen principal de la noticia, portada de la
-- galería, hero, logo): sirve para reemplazar sin duplicar.
CREATE UNIQUE INDEX idx_portal_archivos_tipo_padre ON portal_archivos (tipo, padre_id);
CREATE INDEX idx_portal_archivos_key_r2 ON portal_archivos (key_r2) WHERE key_r2 IS NOT NULL;

-- --------------------------- configuración ---------------------------

CREATE TABLE portal_configuracion (
  config_id     INTEGER PRIMARY KEY CHECK (config_id = 1),
  nombre        TEXT NOT NULL DEFAULT '',
  descripcion   TEXT NOT NULL DEFAULT '',
  whatsapp      TEXT NOT NULL DEFAULT '',
  telefono      TEXT NOT NULL DEFAULT '',
  facebook      TEXT NOT NULL DEFAULT '',
  instagram     TEXT NOT NULL DEFAULT '',
  youtube       TEXT NOT NULL DEFAULT '',
  twitter       TEXT NOT NULL DEFAULT '',
  pie           TEXT NOT NULL DEFAULT '',
  mostrar_hero  INTEGER NOT NULL DEFAULT 1 CHECK (mostrar_hero IN (0, 1)),
  mostrar_fotos INTEGER NOT NULL DEFAULT 1 CHECK (mostrar_fotos IN (0, 1)),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO portal_configuracion (config_id) VALUES (1);

-- --------------------- vista de archivos públicos ---------------------
--
-- Sólo entra lo PUBLICADO: así el Worker sirve /i/{id} sin volver a preguntar
-- por el padre en cada petición de imagen.

CREATE VIEW portal_archivos_publicos AS
SELECT a.archivo_id, a.tipo, a.padre_id, a.url_publico, a.mime, a.tamano_bytes
FROM portal_archivos a
WHERE a.es_publico = 1
  AND (
    (a.tipo = 'noticia.imagen_principal'
      AND EXISTS (SELECT 1 FROM portal_noticias n WHERE n.id = a.padre_id AND n.status = 'published'))
    OR
    (a.tipo IN ('galeria.portada', 'galeria.foto')
      AND EXISTS (SELECT 1 FROM portal_galleries g WHERE g.id = a.padre_id AND g.status = 'published'))
    OR
    (a.tipo = 'complejo.imagen'
      AND EXISTS (SELECT 1 FROM portal_pages p WHERE p.id = a.padre_id AND p.status = 'published'))
  );