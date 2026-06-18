require('dotenv').config({ path: 'apps/dashboard/.env.local' });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    // get latest import
    const { data: latest } = await sb.from('importaciones_excel')
        .select('id, proveedor, mapeo_columnas')
        .order('creado_el', { ascending: false })
        .limit(1)
        .single();
    
    console.log("Latest import:", latest.id);
    
    // get vigente import
    const { data: vigente } = await sb.from('listas_precios_proveedor')
        .select('importacion_id')
        .eq('proveedor', latest.proveedor)
        .eq('vigente', true)
        .single();
        
    console.log("Vigente import:", vigente.importacion_id);
    
    const colModelo = latest.mapeo_columnas?.columna_modelo;
    console.log("Col modelo:", colModelo);

    // Get a sample row from latest
    const { data: sRow } = await sb.from('listas_precios_raw')
        .select('payload')
        .eq('importacion_id', latest.id)
        .limit(1)
        .single();

    // Get matching row from vigente
    const { data: oRow } = await sb.from('listas_precios_raw')
        .select('payload')
        .eq('importacion_id', vigente.importacion_id)
        .eq(`payload->>${colModelo}`, sRow.payload[colModelo])
        .limit(1)
        .single();
        
    console.log("New payload:", sRow.payload);
    console.log("Old payload:", oRow?.payload);
    console.log("Equal?", JSON.stringify(sRow.payload) === JSON.stringify(oRow?.payload));
}

run();
