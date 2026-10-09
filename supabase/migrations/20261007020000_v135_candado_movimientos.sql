-- v135: candado de movimientos históricos (>30 días) — trigger DURO.
-- Los movimientos (ingresos/egresos) con fecha > 30 días quedan fijados:
--   - INSERT con fecha vieja  -> bloqueado
--   - DELETE de un viejo      -> bloqueado
--   - UPDATE de un viejo      -> bloqueado SI cambian campos esenciales
--                                (cantidad / articulo_id / fecha / guia)
--   - UPDATE de campos operativos (estado_envio, edo_reunido, notas, imagenes, etc.) -> permitido
--
-- Aviso: el bloqueo lanza excepción con mensaje descriptivo. La persistencia del
-- aviso la hace el consumidor (sync/API) que captura la excepción, en avisos_movimientos.

CREATE TABLE IF NOT EXISTS public.avisos_movimientos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tabla text NOT NULL,
    operacion text NOT NULL,
    movimiento_id text,
    fecha_movimiento timestamptz,
    detalle jsonb,
    creado_el timestamptz DEFAULT now(),
    atendido boolean DEFAULT false
);

CREATE OR REPLACE FUNCTION public.fn_bloquear_movimientos_antiguos()
RETURNS trigger AS $$
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

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bloquear_ingresos_antiguos ON public.ingresos;
CREATE TRIGGER trg_bloquear_ingresos_antiguos
BEFORE UPDATE OR DELETE OR INSERT ON public.ingresos
FOR EACH ROW EXECUTE FUNCTION public.fn_bloquear_movimientos_antiguos();

DROP TRIGGER IF EXISTS trg_bloquear_egresos_antiguos ON public.egresos;
CREATE TRIGGER trg_bloquear_egresos_antiguos
BEFORE UPDATE OR DELETE OR INSERT ON public.egresos
FOR EACH ROW EXECUTE FUNCTION public.fn_bloquear_movimientos_antiguos();
