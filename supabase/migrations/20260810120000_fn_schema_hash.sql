-- Migration: fn_schema_hash()
-- Calcula un hash SHA-256 determinista del esquema publico (funciones + tablas/columnas + triggers).
-- Usado por scripts/generate_flow_blueprint.ts para poblar blueprint.schema_hash
-- y por scripts/ci_validate_blueprint.ts para detectar obsolescencia y disparar regeneracion.
-- Nota: no depende de track_functions (no disponible de forma persistente en Supabase gestionado).

CREATE OR REPLACE FUNCTION public.fn_schema_hash()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  WITH funcs AS (
    SELECT n.nspname AS schema, p.proname AS name, md5(p.prosrc) AS body_hash
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  ),
  cols AS (
    SELECT c.relname AS table_name, a.attname AS column_name,
           format_type(a.atttypid, a.atttypmod) AS data_type, a.attnotnull
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND a.attnum > 0 AND NOT a.attisdropped
  ),
  trigs AS (
    SELECT t.tgname, c.relname AS table_name, p.proname AS target_function
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_proc p ON t.tgfoid = p.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE NOT t.tgisinternal AND n.nspname = 'public'
  ),
  parts AS (
    SELECT string_agg(schema || '.' || name || ':' || body_hash, '|' ORDER BY schema, name) AS s FROM funcs
    UNION ALL
    SELECT string_agg(table_name || '.' || column_name || ':' || data_type || ':' || attnotnull::text, '|'
           ORDER BY table_name, column_name) FROM cols
    UNION ALL
    SELECT string_agg(table_name || '.' || tgname || '->' || target_function, '|'
           ORDER BY table_name, tgname) FROM trigs
  )
  SELECT encode(digest(string_agg(COALESCE(s, ''), '||' ORDER BY s), 'sha256'), 'hex')
  FROM parts;
$$;

-- Requiere pgcrypto para digest(); en Supabase suele estar disponible.
-- Si no lo esta, se hace fallback en el generador (crypto local en Node).
COMMENT ON FUNCTION public.fn_schema_hash() IS 'Hash determinista del esquema public para deteccion de obsolescencia del DB Flow Blueprint.';
