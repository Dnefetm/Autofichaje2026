-- Migración: Corregir bug crítico en fn_bloquear_movimientos_antiguos
-- Problema: La función terminaba con 'RETURN NEW;'. En triggers BEFORE DELETE,
-- NEW es NULL en PostgreSQL. Retornar NULL en un trigger BEFORE aborta silenciosamente
-- la operación DELETE sin arrojar error ni borrar la fila.
-- Solución: Retornar OLD si TG_OP = 'DELETE', y NEW en INSERT/UPDATE.

CREATE OR REPLACE FUNCTION public.fn_bloquear_movimientos_antiguos()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    v_fecha timestamptz;
    v_bloquear boolean;
BEGIN
    -- Fecha del movimiento: para INSERT es la nueva; para UPDATE/DELETE la existente.
    IF TG_OP = 'INSERT' THEN
        v_fecha := COALESCE(NEW.fecha, NEW.creado_el);
    ELSE
        v_fecha := COALESCE(OLD.fecha, OLD.creado_el);
    END IF;

    v_bloquear := false;
    IF v_fecha IS NOT NULL AND v_fecha < now() - interval '30 days' THEN
        IF TG_OP = 'INSERT' OR TG_OP = 'DELETE' THEN
            v_bloquear := true;
        ELSIF TG_OP = 'UPDATE' THEN
            -- Solo bloquea si cambia la esencia del movimiento (no los estados operativos).
            v_bloquear := (NEW.cantidad IS DISTINCT FROM OLD.cantidad)
                       OR (NEW.articulo_id IS DISTINCT FROM OLD.articulo_id)
                       OR (NEW.fecha IS DISTINCT FROM OLD.fecha)
                       OR (NEW.guia IS DISTINCT FROM OLD.guia);
        END IF;
    END IF;

    IF v_bloquear THEN
        RAISE EXCEPTION 'Movimiento bloqueado (antiguo >30 días): tabla=%, operación=%, fecha=%. Para cambiarlo contacta al propietario de la base de datos.',
            TG_TABLE_NAME, TG_OP, v_fecha;
    END IF;

    -- CORRECCIÓN CRÍTICA:
    -- En triggers BEFORE DELETE, se DEBE retornar OLD.
    -- Retornar NEW (que es NULL) cancela silenciosamente el DELETE en PostgreSQL.
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$function$;
