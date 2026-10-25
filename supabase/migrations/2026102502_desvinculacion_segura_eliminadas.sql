-- 2026102502: Desvinculación segura con trazabilidad para publicaciones cerradas/eliminadas en MeLi
-- y restauración de sync_disabled en catálogos falsamente bloqueados.

-- 1. Tabla de respaldo/auditoría para desvinculaciones seguras (Reversible por diseño)
CREATE TABLE IF NOT EXISTS public.mapeo_desvinculados_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publicacion_id UUID NOT NULL,
    external_item_id TEXT,
    articulo_id TEXT NOT NULL,
    cantidad_requerida NUMERIC DEFAULT 1,
    sincronizar_stock BOOLEAN DEFAULT true,
    motivo TEXT NOT NULL,
    desvinculado_el TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB
);

-- 2. Respaldar en el log los 34-35 mapeos de publicaciones cerradas y eliminadas en MeLi
INSERT INTO public.mapeo_desvinculados_log (publicacion_id, external_item_id, articulo_id, cantidad_requerida, sincronizar_stock, motivo, metadata)
SELECT 
    m.publicacion_id,
    pe.external_item_id,
    m.articulo_id,
    m.cantidad_requerida,
    m.sincronizar_stock,
    'meli_deleted',
    jsonb_build_object(
        'titulo', pe.titulo,
        'status_externo', pe.status_externo,
        'sub_status', pe.sub_status,
        'tipo_publicacion', pe.tipo_publicacion
    )
FROM public.mapeo_publicacion_articulo m
JOIN public.publicaciones_externas pe ON pe.id = m.publicacion_id
WHERE pe.status_externo = 'closed'
  AND 'deleted' = ANY(pe.sub_status)
ON CONFLICT DO NOTHING;

-- 3. Eliminar de mapeo activo únicamente las publicaciones respaldadas
DELETE FROM public.mapeo_publicacion_articulo m
USING public.publicaciones_externas pe
WHERE pe.id = m.publicacion_id
  AND pe.status_externo = 'closed'
  AND 'deleted' = ANY(pe.sub_status);

-- 4. Actualizar flags en publicaciones_externas para que reflejen su estado real
UPDATE public.publicaciones_externas
SET 
    esta_mapeado = false,
    posible_eliminada = true,
    actualizado_el = NOW()
WHERE status_externo = 'closed'
  AND 'deleted' = ANY(sub_status);

-- 5. Restaurar publicaciones de catálogo falsamente apagadas con sync_disabled por rechazo de available_quantity
-- El stock se delega a la tradicional vinculada, y el precio vuelve a sincronizar libremente.
UPDATE public.mapeo_publicacion_articulo m
SET sincronizar_stock = false
FROM public.publicaciones_externas pe
WHERE pe.id = m.publicacion_id
  AND (pe.sync_disabled_reason ILIKE '%catalog_listing%' OR pe.sync_disabled_reason ILIKE '%item.catalog_listing%');

UPDATE public.publicaciones_externas
SET 
    sync_disabled = false,
    sync_disabled_reason = NULL,
    actualizado_el = NOW()
WHERE sync_disabled_reason ILIKE '%catalog_listing%' 
   OR sync_disabled_reason ILIKE '%item.catalog_listing%';
