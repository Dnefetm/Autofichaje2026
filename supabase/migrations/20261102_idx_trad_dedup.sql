-- Índices parciales B-Tree para las subconsultas EXISTS de deduplicación de
-- v_urgencia_precios. El rol `anon` (navegador) tiene statement_timeout = 3s, y la
-- vista en frío ronda los 2.9s; estos índices evitan el escaneo + filtro extra en
-- cada EXISTS (tipo_publicacion='tradicional' AND status_externo<>'closed').
CREATE INDEX IF NOT EXISTS idx_pub_ext_trad_dedup
ON public.publicaciones_externas (external_item_id)
WHERE tipo_publicacion = 'tradicional' AND status_externo <> 'closed';

CREATE INDEX IF NOT EXISTS idx_pub_cat_trad_dedup
ON public.publicaciones_externas (id_producto_catalogo, marketplace_id)
WHERE tipo_publicacion = 'tradicional' AND status_externo <> 'closed';
