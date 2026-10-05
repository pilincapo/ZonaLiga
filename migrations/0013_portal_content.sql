-- Fase 18.2: CONTENIDO DEL PORTAL (Noticias, Fotos y Páginas).
--
-- Todo esto es EDITORIAL: no toca fixture, resultados, posiciones ni la
-- configuración deportiva, que siguen viviendo en sus tablas de siempre.
--
-- Las imágenes se guardan como URL (http/https), igual que logo_url de los
-- equipos: no se suben binarios a D1 ni se agrega ningún servicio externo.

CREATE TABLE portal_noticias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  resumen TEXT NOT NULL DEFAULT '',
  -- Texto plano: se escapa al renderizar, así nunca entra HTML ajeno.
  contenido TEXT NOT NULL DEFAULT '',
  -- URL de la imagen principal ('' = sin imagen).
  imagen TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published')),
  destacada INTEGER NOT NULL DEFAULT 0,
  -- Fecha de publicación (YYYY-MM-DD); queda en NULL mientras es borrador.
  published_at TEXT,
  autor TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- El listado público recorre solo las publicadas, de más nueva a más vieja.
CREATE INDEX idx_portal_noticias_pub ON portal_noticias(status, published_at);

CREATE TABLE portal_galleries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  -- URL de la imagen de portada de la galería.
  portada TEXT NOT NULL DEFAULT '',
  -- Fecha del hecho/foto (YYYY-MM-DD), opcional.
  fecha TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_portal_galleries_pub ON portal_galleries(status, fecha);

CREATE TABLE portal_gallery_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gallery_id INTEGER NOT NULL REFERENCES portal_galleries(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  -- Orden de muestra dentro de la galería (1, 2, 3…).
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_portal_gallery_images_gallery ON portal_gallery_images(gallery_id, orden);

-- Páginas editoriales con formato propio: 'complejo' y 'torneo'. Los campos
-- viven en `data` como JSON (mismo patrón que tournaments.config): así se puede
-- sumar un campo nuevo sin tocar el schema. Cada página tiene su propio
-- estado de publicación.
CREATE TABLE portal_pages (
  slug TEXT PRIMARY KEY CHECK (slug IN ('complejo', 'torneo')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published')),
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
