-- Migración A (seguridad urgente): cierra exposición de movimientos_purgados_log
-- y fn_restaurar_movimiento_purgado al rol anon/authenticated.
-- Causa: pg_default_acl del schema public otorga arwdDxtm a anon en toda tabla nueva
-- y EXECUTE a anon/PUBLIC en toda función nueva (creadas en c416066 sin RLS ni REVOKE).
-- La función es SECURITY DEFINER (owner postgres) y salta RLS de ingresos/egresos.
ALTER TABLE public.movimientos_purgados_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.movimientos_purgados_log FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_restaurar_movimiento_purgado(uuid) FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.fn_restaurar_movimiento_purgado(uuid) SET search_path = '';
