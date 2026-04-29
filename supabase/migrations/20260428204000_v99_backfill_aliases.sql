-- v99 (corregido) — Backfill del diccionario desde matches automáticos exactos
-- Premisa: nivel=1 AND pct=100 son matches por código universal exactos = alta confianza.
-- Idempotente gracias a ux_alias_codigo / ux_alias_fallback.

INSERT INTO public.proveedor_articulos_alias
  (proveedor, codigo_excel, marca_excel, modelo_excel, articulo_id)
SELECT DISTINCT ON (proveedor, codigo_universal_excel, marca_excel, modelo_excel)
       proveedor,
       NULLIF(btrim(codigo_universal_excel), ''),
       NULLIF(btrim(marca_excel), ''),
       NULLIF(btrim(modelo_excel), ''),
       cand_articulo_id
FROM public.matching_decisiones
WHERE nivel = 1
  AND pct  = 100
  AND cand_articulo_id IS NOT NULL
ORDER BY proveedor, codigo_universal_excel, marca_excel, modelo_excel, id
ON CONFLICT DO NOTHING;
