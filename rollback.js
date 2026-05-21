require('dotenv').config({ path: 'apps/dashboard/.env.local' });

const url = process.env.SUPABASE_URL + '/rest/v1/rpc/exec_sql';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const sql = `
DO $$ 
DECLARE
    v_prov text;
BEGIN
    SELECT proveedor INTO v_prov FROM importaciones_excel WHERE id = 'ea62b745-1759-47ba-86a6-024f8e114fbd';
    
    IF v_prov IS NULL THEN
        RAISE NOTICE 'Importacion no encontrada';
        RETURN;
    END IF;

    -- Borramos la entrada en listas_precios_proveedor que hizo fn_preparar_importacion_revision
    DELETE FROM listas_precios_proveedor WHERE importacion_id = 'ea62b745-1759-47ba-86a6-024f8e114fbd';
    
    -- Restauramos la vigencia de la ultima lista valida de ese proveedor
    UPDATE listas_precios_proveedor
    SET vigente = true
    WHERE id = (
        SELECT id FROM listas_precios_proveedor 
        WHERE proveedor = v_prov 
        ORDER BY creado_el DESC LIMIT 1
    );
      
    -- Marcamos la importacion como error/cancelada
    UPDATE importaciones_excel 
    SET estado = 'error', error_mensaje = 'Cancelada por Rollback de Emergencia (Carga Parcial)'
    WHERE id = 'ea62b745-1759-47ba-86a6-024f8e114fbd';
    
    INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje) 
    VALUES ('ea62b745-1759-47ba-86a6-024f8e114fbd', 'ERROR_FATAL', 'Rollback de emergencia por bug de carga parcial');

END $$;
`;

fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': 'Bearer ' + key,
  },
  body: JSON.stringify({ sql_query: sql })
}).then(async r => {
    const text = await r.text();
    console.log('Response:', r.status, text);
}).catch(e => console.error('Error:', e.message));
