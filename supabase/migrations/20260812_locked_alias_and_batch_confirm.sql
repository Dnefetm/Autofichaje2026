-- =========================================================
-- 1) Bloqueo de alias para preservar mapeos manuales
-- =========================================================
ALTER TABLE public.proveedor_articulos_alias
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text;

CREATE INDEX IF NOT EXISTS ix_paa_locked ON public.proveedor_articulos_alias (locked) WHERE locked = true;

-- =========================================================
-- 2) Nueva tabla de jobs de confirmación batch (idempotente)
--    NOTA: FK apunta a public.importaciones_excel (nombre real en DB).
-- =========================================================
CREATE TABLE IF NOT EXISTS public.matching_confirm_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  importacion_id uuid NOT NULL REFERENCES public.importaciones_excel(id) ON DELETE CASCADE,
  decisiones jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  processed int NOT NULL DEFAULT 0,
  total int NOT NULL DEFAULT 0,
  alias_aprendidos int NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS ix_mcj_status_created ON public.matching_confirm_jobs (status, created_at) WHERE status IN ('queued','running');

-- =========================================================
-- 3) Vista helper para la UI de revisión
--    NOTA: matching_decisiones no tiene columna "candidatos" jsonb.
--    La reconstruimos desde columnas cand_* (una fila = un candidato).
-- =========================================================
CREATE OR REPLACE VIEW public.v_matching_review AS
SELECT
  md.id                      AS md_id,
  md.importacion_id,
  md.proveedor,
  md.codigo_universal_excel  AS gtin,
  md.marca_excel,
  md.modelo_excel,
  md.nivel,
  md.confirmado,
  md.articulo_id_final,
  CASE WHEN md.cand_articulo_id IS NOT NULL THEN
    jsonb_build_array(jsonb_build_object(
      'articulo_id', md.cand_articulo_id,
      'marca',       md.cand_marca,
      'modelo',      md.cand_modelo,
      'codigo',      md.cand_codigo,
      'nombre',      md.cand_nombre,
      'score',       md.pct
    ))
  ELSE '[]'::jsonb END AS candidatos,
  (SELECT count(*) FROM articulos a WHERE a.codigo_universal = md.codigo_universal_excel) AS gtin_dupes
FROM public.matching_decisiones md;
