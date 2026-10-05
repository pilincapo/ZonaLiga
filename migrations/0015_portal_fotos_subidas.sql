-- Fase 18.3 — Fotos de galería subidas como archivo.
--
-- Las fotos de una galería viven en `portal_gallery_images` (son contenido, con
-- su orden y su pie de foto). Cuando la foto se SUBE en lugar de enlazarse,
-- el binario va a R2 y esta columna guarda el `portal_archivos` que lo contiene:
-- así, al quitar la foto se puede borrar también el archivo del bucket (que si
-- no se acumularía basura sin referencia).
--
-- La columna es opcional: las fotos con enlace externo (y las cargadas antes de
-- esta fase) la siguen teniendo en NULL y siguen funcionando igual.

ALTER TABLE portal_gallery_images ADD COLUMN archivo_id INTEGER
  REFERENCES portal_archivos(archivo_id) ON DELETE SET NULL;

CREATE INDEX idx_portal_gallery_images_archivo ON portal_gallery_images (archivo_id)
  WHERE archivo_id IS NOT NULL;

-- La vista de archivos públicos (migración 0014) cambia: la foto de galería
-- ahora se cuelga de la fila de `portal_gallery_images`, no de la galería.
DROP VIEW portal_archivos_publicos;

CREATE VIEW portal_archivos_publicos AS
SELECT a.archivo_id, a.tipo, a.padre_id, a.url_publico, a.mime, a.tamano_bytes
FROM portal_archivos a
WHERE a.es_publico = 1
  AND (
    (a.tipo = 'noticia.imagen_principal'
      AND EXISTS (SELECT 1 FROM portal_noticias n WHERE n.id = a.padre_id AND n.status = 'published'))
    OR
    (a.tipo = 'galeria.portada'
      AND EXISTS (SELECT 1 FROM portal_galleries g WHERE g.id = a.padre_id AND g.status = 'published'))
    OR
    (a.tipo = 'galeria.foto'
      AND EXISTS (
        SELECT 1 FROM portal_gallery_images i
        JOIN portal_galleries g ON g.id = i.gallery_id
        WHERE i.id = a.padre_id AND g.status = 'published'
      ))
    OR
    (a.tipo = 'complejo.imagen'
      AND EXISTS (SELECT 1 FROM portal_pages p WHERE p.slug = 'complejo' AND p.status = 'published'))
    OR
    (a.tipo IN ('config.hero', 'config.logo')
      AND EXISTS (SELECT 1 FROM portal_configuracion c WHERE c.status = 'published'))
  );