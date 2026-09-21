-- =============================================================================
-- v71_articulos_ddl_real.sql
-- Snapshot VERIFICADO del DDL real de public.articulos y de TODAS las llaves
-- foráneas que apuntan a articulos(articulo_id).
--
-- Origen de los datos: consultas ejecutadas el 2026-09-13 contra la base VIVA
-- (proyecto Supabase fichas-tecnicas-auto, ref ryxdqnzyvnrwalylqyvm):
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema='public' and table_name='articulos';
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint where conrelid='public.articulos'::regclass;
--   select conrelid::regclass, conname, pg_get_constraintdef(oid)
--     from pg_constraint where confrelid='public.articulos'::regclass;
--   select indexdef from pg_indexes
--    where schemaname='public' and tablename='articulos';
--
-- MOTIVO: packages/db/schema.sql está DESACTUALIZADO respecto a la base viva
-- (p. ej. declara inventory_snapshot.sku como RESTRICT cuando en producción es
-- ON DELETE CASCADE, y declara una FK de document_sources hacia articulos que
-- en la base viva NO existe). Cualquier decisión sobre purgas/borrados debe
-- tomarse con este archivo, no con schema.sql.
--
-- Esta migración es INFORMATIVA e IDEMPOTENTE: todas las sentencias reales están
-- comentadas; solo se ejecuta un bloque de verificación que falla si el estado
-- de la base deja de coincidir con este snapshot.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Estructura real de public.articulos (36 columnas, en orden ordinal)
-- -----------------------------------------------------------------------------
-- CREATE TABLE public.articulos (
--   nombre                  text,
--   marca                   text,
--   modelo                  text,
--   variante                text,
--   categoria               text,
--   descripcion             text,
--   codigo_universal        text,
--   codigo_sat              text,
--   codigos_marketplace     text[],
--   caja_madre              text,
--   peso_kg                 numeric,
--   largo_cm                numeric,
--   ancho_cm                numeric,
--   alto_cm                 numeric,
--   materiales              text,
--   atributos_especificos   jsonb        DEFAULT '{}'::jsonb,
--   metadata_atributos      jsonb        DEFAULT '{}'::jsonb,
--   importador_id           uuid,
--   pais_origen             text,
--   requiere_etiqueta_nom   boolean      DEFAULT false,
--   requiere_embalaje_esp   boolean      DEFAULT false,
--   publicacion_ml          text,
--   url_producto            text,
--   es_full                 boolean      DEFAULT false,
--   es_dropshipping         boolean      DEFAULT false,
--   es_obsoleto             boolean      DEFAULT false,
--   notas                   text,
--   imagenes                text[],
--   url_video               text,
--   activo                  boolean      DEFAULT true,
--   creado_el               timestamptz  DEFAULT now(),
--   actualizado_el          timestamptz  DEFAULT now(),
--   articulo_id             text         NOT NULL DEFAULT (gen_random_uuid())::text,
--   nom050                  text,
--   disponibles             integer      NOT NULL DEFAULT 0,
--   sync_hash               text,
--   origin                  text,
--   CONSTRAINT articulos_pkey PRIMARY KEY (articulo_id)
-- );
--
-- NOTA: articulos_pkey es la ÚNICA constraint propia de la tabla
-- (no hay UNIQUE, CHECK ni FK salientes).
-- NOTA: articulo_id es text (no uuid) y su default es un uuid casteado a text;
--   por eso conviven IDs tipo uuid, IDs cortos de 8 hex e IDs de AppSheet
--   ("13feb0128"). Las celdas con forma de fecha en Sheets deben leerse con
--   getDisplayValues() para no corromperse.

-- -----------------------------------------------------------------------------
-- 2) Índices reales
-- -----------------------------------------------------------------------------
-- CREATE UNIQUE INDEX articulos_pkey ON public.articulos USING btree (articulo_id);
-- CREATE INDEX idx_articulos_articulo_id_trgm      ON public.articulos USING gin (articulo_id gin_trgm_ops);
-- CREATE INDEX idx_articulos_caja_madre            ON public.articulos USING btree (caja_madre);
-- CREATE INDEX idx_articulos_codigo_universal_trgm ON public.articulos USING gin (codigo_universal gin_trgm_ops);
-- CREATE INDEX idx_articulos_marca_modelo_trgm     ON public.articulos USING gin (lower(((marca || ' '::text) || modelo)) gin_trgm_ops);
-- CREATE INDEX idx_articulos_marca_trgm            ON public.articulos USING gin (marca gin_trgm_ops);
-- CREATE INDEX idx_articulos_modelo_lower          ON public.articulos USING btree (lower(TRIM(BOTH FROM modelo)));
-- CREATE INDEX idx_articulos_modelo_norm           ON public.articulos USING btree (lower(f_unaccent_immutable(TRIM(BOTH FROM modelo))));
-- CREATE INDEX idx_articulos_modelo_trgm           ON public.articulos USING gin (modelo gin_trgm_ops);
-- CREATE INDEX idx_articulos_nombre_trgm           ON public.articulos USING gin (nombre gin_trgm_ops);
-- CREATE INDEX idx_articulos_variante_trgm         ON public.articulos USING gin (variante gin_trgm_ops);
-- CREATE INDEX ix_art_codigo_norm                  ON public.articulos USING btree (lower(f_unaccent_immutable(TRIM(BOTH FROM codigo_universal)))) WHERE (activo = true);
-- CREATE INDEX ix_art_codigo_universal             ON public.articulos USING btree (codigo_universal);
-- CREATE INDEX ix_art_marca_modelo                 ON public.articulos USING btree (marca, modelo);
-- CREATE INDEX ix_art_marca_modelo_lower           ON public.articulos USING btree (lower(marca), lower(modelo));
-- CREATE INDEX ix_art_modelo_lower                 ON public.articulos USING btree (lower(modelo));
-- CREATE INDEX ix_art_modelo_norm                  ON public.articulos USING btree (lower(f_unaccent_immutable(TRIM(BOTH FROM modelo))));

-- -----------------------------------------------------------------------------
-- 3) LAS 16 FKs que apuntan a articulos(articulo_id)  (todas ON UPDATE NO ACTION)
--    11 con ON DELETE CASCADE + 5 sin cláusula (= NO ACTION, bloquean el DELETE)
-- -----------------------------------------------------------------------------
--  CASCADE (el borrado del artículo arrastra estas filas):
--   bundle_components.bundle_sku            -> bundle_components_bundle_sku_fkey            ON DELETE CASCADE
--   bundle_components.component_sku         -> bundle_components_component_sku_fkey         ON DELETE CASCADE
--   inventory_snapshot.sku                  -> fk_inventory_snapshot_articulo               ON DELETE CASCADE
--   mapeo_publicacion_articulo.articulo_id  -> fk_mapeo_articulo                            ON DELETE CASCADE
--   marketplace_prices.articulo_id          -> marketplace_prices_articulo_id_fkey          ON DELETE CASCADE
--   ml_publicacion_sync_queue.articulo_id   -> ml_publicacion_sync_queue_articulo_id_fkey   ON DELETE CASCADE
--   precio_recalc_queue.articulo_id         -> precio_recalc_queue_articulo_id_fkey         ON DELETE CASCADE
--   precios_historial_proveedor.articulo_id -> precios_historial_proveedor_articulo_id_fkey ON DELETE CASCADE
--   precios_publicacion.articulo_id         -> fk_marketplace_prices_articulo               ON DELETE CASCADE
--   precios_publicados.articulo_id          -> precios_publicados_articulo_id_fkey          ON DELETE CASCADE
--   proveedor_articulos_alias.articulo_id   -> proveedor_articulos_alias_articulo_id_fkey   ON DELETE CASCADE
--
--  NO ACTION (si hay filas hijas, el DELETE del artículo FALLA):
--   costos_articulo.articulo_id             -> costos_articulo_articulo_id_fkey
--   fichas_tecnicas.articulo_id             -> fichas_tecnicas_articulo_id_fkey
--   orden_items.articulo_id                 -> orden_items_articulo_id_fkey
--   precio_revisiones_manuales.articulo_id  -> precio_revisiones_manuales_articulo_id_fkey
--   reservaciones_stock.articulo_id         -> reservaciones_stock_articulo_id_fkey
--
--  IMPORTANTE: document_sources NO tiene FK hacia articulos en la base viva,
--  aunque packages/db/schema.sql la declare.

-- -----------------------------------------------------------------------------
-- 4) Verificación idempotente (no modifica nada; falla si el esquema cambió)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  n_total   int;
  n_cascade int;
BEGIN
  SELECT count(*) INTO n_total
    FROM pg_constraint
   WHERE confrelid = 'public.articulos'::regclass;

  SELECT count(*) INTO n_cascade
    FROM pg_constraint
   WHERE confrelid = 'public.articulos'::regclass
     AND confdeltype = 'c';

  IF n_total <> 16 OR n_cascade <> 11 THEN
    RAISE WARNING 'v71: el mapa de FKs de articulos cambió (total=%, cascade=%; snapshot 2026-09-13: total=16, cascade=11). Actualizar FKS_ARTICULOS en packages/scripts/reconciliar.gs antes de purgar.',
      n_total, n_cascade;
  END IF;
END $$;
