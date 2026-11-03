-- Migración: Cerrar hueco de seguridad en mapeo_desvinculados_log
-- Problema: la tabla no tenía RLS y anon/authenticated heredaban privilegios
-- por defecto del schema public (pg_default_acl), pudiendo leer/borrar el log
-- de desvinculaciones con la anon key pública del frontend.
-- Verificado en vivo: el único escritor de esta tabla es
-- apps/dashboard/src/app/api/vinculacion/confirmar-lote/route.ts (L44),
-- que usa supabaseAdmin (service_role). Ningún cliente browser la escribe.
-- service_role conserva acceso porque se salta RLS.

ALTER TABLE public.mapeo_desvinculados_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mapeo_desvinculados_log FROM anon, authenticated;
