const fs = require('fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');

// Cargar credenciales
const env = dotenv.parse(fs.readFileSync('.env'));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    console.log("🚀 [1/4] Creando Excel de prueba en memoria (5,000 filas)...");
    
    const startExcel = Date.now();
    const mockData = [['Marca', 'Modelo', 'Precio']];
    for (let i = 0; i < 5000; i++) {
        mockData.push(['TRUPER', `T-${i}`, 150 + i]);
    }
    const ws = XLSX.utils.aoa_to_sheet(mockData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Precios');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    console.log(`✅ Excel creado en ${Date.now() - startExcel}ms (Tamaño: ${(buf.byteLength / 1024).toFixed(2)} KB)`);

    console.log("\n🚀 [2/4] Subiendo a Storage (Bucket: excel-precios)...");
    const path = `mock_import_${Date.now()}.xlsx`;
    const { error: uploadErr } = await supabase.storage.from('excel-precios').upload(path, buf, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (uploadErr) {
        console.error("❌ Fallo subida a Storage:", uploadErr);
        return;
    }
    console.log(`✅ Archivo almacenado como ${path}`);

    console.log("\n🚀 [3/4] Registrando Importación en Base de Datos...");
    const { data: imp, error: insertErr } = await supabase.from('importaciones_excel').insert({
        proveedor: 'Prueba Automática',
        nombre_archivo: path,
        estado: 'pendiente_mapeo',
        mapeo_columnas: {
            _storage_path: path,
            _bucket: 'excel-precios',
            columna_marca: 'Marca',
            columna_modelo: 'Modelo',
            columna_codigo: 'Modelo',
            columna_descripcion: 'Modelo',
            columna_moneda: 'MXN',
            moneda_default: 'MXN',
            precios: [{ tipo_costo: 'Lista', columna: 'Precio', incluye_iva: false }]
        }
    }).select('id').single();

    if (insertErr || !imp) {
        console.error("❌ Fallo insertar en BD:", insertErr);
        return;
    }
    console.log(`✅ Importación creada (ID: ${imp.id}) - Estado DB: pendiente_mapeo`);

    // --- SIMULACIÓN DE NEXT.JS PARSER ---
    console.log("\n🚀 [4/4] Ejecutando simulación de Parser y RPC...");
    console.log("   -> Estado actual cambiado a: mapeando");
    await supabase.from('importaciones_excel').update({ estado: 'mapeando' }).eq('id', imp.id);
    
    try {
        console.log("   -> Extrayendo y parseando XLSX simulando Serverless...");
        const startParser = Date.now();
        const { data: file } = await supabase.storage.from('excel-precios').download(path);
        const fileBuf = new Uint8Array(await file.arrayBuffer());
        const wbRead = XLSX.read(fileBuf, { type: 'buffer', dense: true });
        const sheet = wbRead.Sheets[wbRead.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        
        console.log(`   -> Parseo Exitoso en ${Date.now() - startParser}ms! Filas detectadas: ${rows.length - 1}`);
        
        console.log("   -> Limpiando tablas staging para proveeder 'Prueba Automática'...");
        await supabase.from('listas_precios_raw_staging').delete().eq('proveedor', 'Prueba Automática');

        // Insertar chunk directo
        console.log("   -> Inyectando Chunk en base de datos...");
        const insertBatch = [];
        for (let i = 1; i < rows.length; i++) {
            insertBatch.push({ importacion_id: imp.id, proveedor: 'Prueba Automática', fila_num: i, columnas_guardadas: rows[0], payload: Object.fromEntries(rows[0].map((k, idx) => [k, rows[i][idx]])) });
        }
        await supabase.from('listas_precios_raw_staging').insert(insertBatch);
        console.log("   -> Inyección cruda finalizada.");

        console.log("\n⚡ Ejecutando transición Final: fn_preparar_importacion_revision (ESTO ERA LO QUE FALLABA)");
        const { error: rpcErr } = await supabase.rpc('fn_preparar_importacion_revision', {
            p_importacion_id: imp.id,
            p_proveedor: 'Prueba Automática'
        });

        if (rpcErr) {
            console.error("❌ ERROR CRÍTICO EN RPC:", rpcErr);
            throw rpcErr;
        }
        
        console.log("✅ RPC EJECUTADO CON ÉXITO SIN ERROR DE FORMATO ENUM!");
        
        const { data: check } = await supabase.from('importaciones_excel').select('estado').eq('id', imp.id).single();
        console.log(`🎉 ESTADO FINAL DE LA IMPORTACIÓN EN LA BASE DE DATOS: ---> "${check.estado}" <---`);

        // Descartar automáticamente la prueba
        await supabase.from('importaciones_excel').delete().eq('id', imp.id);
        await supabase.storage.from('excel-precios').remove([path]);
        console.log("\n🧹 Basura de prueba eliminada");

    } catch (e) {
        console.error("\n❌❌ FALLA EN TESTING END-TO-END:", e.message);
    }
}

run();
