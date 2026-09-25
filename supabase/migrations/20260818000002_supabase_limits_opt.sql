-- =============================================================================
-- MIGRACIÓN: Optimización de Límites Supabase (Egress, CPU, Almacenamiento)
-- =============================================================================

-- 1. Activar pg_cron para programar tareas en segundo plano en la BD
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Función de borrado seguro en lotes (batch delete) para no agotar la RAM ni bloquear la tabla
CREATE OR REPLACE PROCEDURE public.sp_limpiar_historial_precios_batch()
LANGUAGE plpgsql AS 
DECLARE
    v_deleted INTEGER := 1;
BEGIN
    WHILE v_deleted > 0 LOOP
        DELETE FROM publication_pricing_history 
        WHERE id IN (
            SELECT id FROM publication_pricing_history 
            WHERE created_at < NOW() - INTERVAL '7 days' 
            LIMIT 5000
        );
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
        COMMIT;
    END LOOP;
END;
;

-- 3. Programar el CRON (Todos los días a las 3:00 AM)
-- Borra automáticamente la historia antigua.
SELECT cron.schedule('cleanup-pricing-history', '0 3 * * *', 'CALL public.sp_limpiar_historial_precios_batch()');

-- 4. Optimización Crítica: Detener la tormenta de CPU en el Trigger
-- Anteriormente: Se disparaba un JOB por cada fila actualizada aunque el valor del costo no hubiera cambiado.
-- Ahora: SOLO dispara si el precio cambia realmente (OLD.valor IS DISTINCT FROM NEW.valor).
CREATE OR REPLACE FUNCTION public.trg_costos_articulo_recalcular_async()
RETURNS TRIGGER LANGUAGE plpgsql AS 
BEGIN
    -- OPTIMIZACIÓN: Solo reaccionar si el valor REALMENTE cambió (evita miles de jobs inútiles en imports masivos)
    IF TG_OP = 'UPDATE' THEN
        IF OLD.valor IS NOT DISTINCT FROM NEW.valor THEN
            RETURN NEW;
        END IF;
    END IF;

    IF NEW.articulo_id IS NOT NULL AND NEW.vigente = true THEN
        INSERT INTO jobs (type, payload, status)
        SELECT 'recalc_pricing_bundle', jsonb_build_object('publicacion_id', m.publicacion_id), 'pending'
        FROM mapeo_publicacion_articulo m
        WHERE m.articulo_id = NEW.articulo_id
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END;
;
