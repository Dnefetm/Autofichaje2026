-- =============================================================================
-- MIGRACIÓN (append-only) Capa 0 — parte 4: índices funcionales para matching
-- =============================================================================
-- Las funciones de clasificación usan lower(trim(...)) en los JOIN. Sin índice
-- funcional, PostgreSQL hace hash join sobre 15k x 8k (~7s). Con estos índices,
-- cada JOIN es un index scan (rápido).
--
-- Idempotente (IF NOT EXISTS). No toca datos. Reversible (DROP al final).
-- =============================================================================
BEGIN;

-- Proveedor_articulos_alias (alias locked): matching por código y por marca+modelo
CREATE INDEX IF NOT EXISTS ix_paa_codigo_lower
    ON public.proveedor_articulos_alias (lower(trim(codigo_excel)));

CREATE INDEX IF NOT EXISTS ix_paa_marca_modelo_lower
    ON public.proveedor_articulos_alias (lower(trim(marca_excel)), lower(trim(modelo_excel)));

-- Articulos: matching por marca+modelo y por modelo (solo)
CREATE INDEX IF NOT EXISTS ix_art_marca_modelo_lower
    ON public.articulos (lower(marca), lower(modelo));

CREATE INDEX IF NOT EXISTS ix_art_modelo_lower
    ON public.articulos (lower(modelo));

COMMIT;

-- ROLLBACK:
-- DROP INDEX IF EXISTS public.ix_paa_codigo_lower;
-- DROP INDEX IF EXISTS public.ix_paa_marca_modelo_lower;
-- DROP INDEX IF EXISTS public.ix_art_marca_modelo_lower;
-- DROP INDEX IF EXISTS public.ix_art_modelo_lower;
