-- Reprocesar importación para arreglar faltantes (Ola 4)
SET statement_timeout = 0;

DO $$
DECLARE
    v_id uuid := 'fb8a73c8-f1fd-4bd9-9cc5-b8654e4f9d9b'::uuid;
BEGIN
    IF EXISTS (SELECT 1 FROM importaciones_excel WHERE id = v_id) THEN
        DELETE FROM matching_decisiones WHERE importacion_id = v_id;
        DELETE FROM costos_articulo WHERE importacion_id = v_id;
        PERFORM fn_match_precios_v2(v_id);
    END IF;
END $$;
