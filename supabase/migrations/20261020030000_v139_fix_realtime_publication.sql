-- v139: Reactivar Supabase Realtime (bug preexistente de monitoreo en vivo).
--
-- Contexto: la publicación `supabase_realtime` tiene puballtables=false y 0 tablas.
-- Por eso `postgres_changes` no emitía eventos para ninguna tabla: el monitor de
-- jobs (monitor/page.tsx) y la barra de progreso + log de importaciones
-- (precios/importaciones/[id]/progreso-importacion.tsx) estaban congelados.
--
-- Este fix agrega a la publicación las 3 tablas que el frontend escucha en vivo:
--   - jobs                 (monitor/page.tsx, event '*')
--   - importaciones_excel  (progreso-importacion.tsx, event 'UPDATE')
--   - importacion_eventos  (progreso-importacion.tsx, event 'INSERT')
--
-- Además, importacion_eventos tiene RLS activado pero 0 políticas, por lo que la
-- lectura directa de anon ya devolvía []. Se añade política SELECT para anon
-- (solo lectura), coherente con el resto de tablas de lectura cliente de v138.
--
-- Nota sobre seguridad: añadir tablas a supabase_realtime NO relaja RLS. Realtime
-- sigue respetando las políticas RLS de cada tabla. Estas 3 tablas solo podrán
-- emitir los eventos que sus políticas permitan a anon (SELECT en las 3).
--
-- Idempotente: ALTER PUBLICATION ADD TABLE falla si la tabla ya está; se usa
-- DO block con chequeo de pg_publication_rel. DROP POLICY IF EXISTS + CREATE POLICY.

-- 1) Agregar tablas a la publicación (solo si no están ya)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr
                   JOIN pg_class c ON c.oid = pr.prrelid
                   JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE pr.prpubid = (SELECT oid FROM pg_publication WHERE pubname = 'supabase_realtime')
                     AND n.nspname = 'public' AND c.relname = 'jobs') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr
                   JOIN pg_class c ON c.oid = pr.prrelid
                   JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE pr.prpubid = (SELECT oid FROM pg_publication WHERE pubname = 'supabase_realtime')
                     AND n.nspname = 'public' AND c.relname = 'importaciones_excel') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.importaciones_excel;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr
                   JOIN pg_class c ON c.oid = pr.prrelid
                   JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE pr.prpubid = (SELECT oid FROM pg_publication WHERE pubname = 'supabase_realtime')
                     AND n.nspname = 'public' AND c.relname = 'importacion_eventos') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.importacion_eventos;
    END IF;
END $$;

-- 2) Política de lectura para anon en importacion_eventos (RLS ya activado, 0 políticas)
DROP POLICY IF EXISTS importacion_eventos_select_anon ON public.importacion_eventos;
CREATE POLICY importacion_eventos_select_anon ON public.importacion_eventos FOR SELECT TO anon USING (true);
