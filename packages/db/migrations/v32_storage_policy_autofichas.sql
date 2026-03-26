-- v32_storage_policy_autofichas.sql
-- Permite que el cliente (anon key) suba archivos directamente al bucket
-- 'documentos-fuente' desde el browser — sin pasar por la serverless function
-- Ejecutar en Supabase SQL Editor (proyecto ryxdqnzyvnrwalylqyvm)

-- ─── Política INSERT para anon en bucket documentos-fuente ─────────────────────
-- Permite upload directo desde el browser usando la anon key
-- Restricción: solo puede subir a la carpeta 'autofichas/'

INSERT INTO storage.policies (name, bucket_id, operation, definition)
VALUES (
    'anon_insert_autofichas',
    'documentos-fuente',
    'INSERT',
    $policy$
    (
        auth.role() = 'anon' OR auth.role() = 'authenticated'
    )
    AND (
        (storage.foldername(name))[1] = 'autofichas'
    )
    $policy$
)
ON CONFLICT (name, bucket_id, operation) DO UPDATE
SET definition = EXCLUDED.definition;

-- ─── Política SELECT (lectura) — necesaria para que la API descargue el archivo
-- ya existente en Storage (server-to-server con service role ya funciona)
-- Esta policy es para que URLs públicas funcionen si el bucket lo está

-- Si el bucket es PRIVADO, agregar esta política para signed URLs:
-- INSERT INTO storage.policies (name, bucket_id, operation, definition)
-- VALUES (
--     'anon_select_autofichas',
--     'documentos-fuente',
--     'SELECT',
--     $$( (storage.foldername(name))[1] = 'autofichas' )$$
-- ) ON CONFLICT (name, bucket_id, operation) DO UPDATE SET definition = EXCLUDED.definition;

-- ─── Alternativa más simple vía Dashboard ─────────────────────────────────────
-- Si el SQL anterior falla (depende de la versión de Supabase), usar el dashboard:
-- Storage → documentos-fuente → Policies → New Policy
-- → "Give users access to only their own top level folder named as uid"
-- → cambiar 'uid' por 'autofichas', operation: INSERT, role: anon
