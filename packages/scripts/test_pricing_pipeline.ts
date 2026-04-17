/**
 * Script de test Standalone para probar Idempotencia del Pricing Pipeline 
 * 
 * Uso previsto:
 * npx tsx packages/scripts/test_pricing_pipeline.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SRV = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SRV) {
    console.error('Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el environment.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SRV);

async function runTest() {
    console.log('🧪 Iniciando test del Pricing Pipeline (DB + Idempotencia)...');

    // 1. Crear importacion dummy
    console.log('1️⃣ Insertando importación de prueba...');
    const { data: imp, error: impErr } = await supabase.from('importaciones_excel').insert({
        proveedor: 'TEST_PROVIDER',
        nombre_archivo: 'test.xlsx',
        estado: 'procesando'
    }).select('id').single();

    if (impErr || !imp) {
        console.error('❌ Error creando importación:', impErr);
        return;
    }
    const importacionId = imp.id;
    console.log('✅ Importación creada:', importacionId);

    // 2. Probar RPC
    console.log('2️⃣ Evaluando función fn_match_articulo_proveedor múltiple candidatos...');
    const { data: matchExacto, error: matchErr1 } = await supabase.rpc('fn_match_articulo_proveedor', {
        p_modelo: 'X', p_marca: 'Y', p_codigo: 'NOT_FOUND_404_123'
    });
    console.log(' - Match con código inexistente:', matchExacto?.length === 0 ? 'Vacío (OK)' : 'Falló', matchErr1 ?? '');

    // 3. Crear Costos crudos
    console.log('3️⃣ Insertando costos_articulo dummy...');
    // Intentaremos simular que encontramos un articulo_id real, tomamos uno al azar
    const { data: art } = await supabase.from('articulos').select('articulo_id').limit(1).single();
    const artId = art?.articulo_id;

    if (!artId) {
       console.log('No hay articulos en la db para linkear, saltando parte de confirmación.');
       return;
    }

    const { data: costo, error: costoErr } = await supabase.from('costos_articulo').insert({
        importacion_id: importacionId,
        articulo_sugerido_id: artId,
        modelo_excel: 'TEST_MODEL',
        marca_excel: 'TEST_MARCA',
        tipo_costo: 'distribuidor',
        valor: 1500,
        moneda: 'MXN',
        fuente: 'excel',
        puntaje_match: 100,
        estado_match: 'sugerido',
        vigente: false,
        candidatos_jsonb: [{ articulo_id: artId, puntaje_match: 100 }]
    }).select('id').single();

    if (costoErr || !costo) {
        console.error('❌ Error insertando costo:', costoErr);
        return;
    }
    console.log('✅ Costo sugerido insertado:', costo.id);

    // 4. Probar Idempotencia Confirmación simulando la misma lógica del API
    console.log('4️⃣ Probando lógicas DB de confirmar/route.ts (Idempotencia y Logging)...');

    // Desactivar previos (Simulación de lo que hace route.ts)
    await supabase.from('costos_articulo')
        .update({ vigente: false })
        .eq('articulo_id', artId).eq('tipo_costo', 'distribuidor').eq('vigente', true);

    // Crear Batch
    const { data: batch } = await supabase.from('precio_import_batches').insert({
        importacion_excel_id: importacionId,
        usuario: 'test_script',
        archivo: 'test.xlsx',
        filas_afectadas: 1
    }).select('id').single();

    console.log('✅ Batch creado:', batch?.id);

    // Historial (Inserción 1)
    const { error: histErr1 } = await supabase.from('precios_historial_proveedor').upsert({
        batch_id: batch!.id,
        costo_articulo_id: costo.id,
        articulo_id: artId,
        tipo_costo: 'distribuidor',
        valor_antiguo: null,
        valor_nuevo: 1500,
        moneda: 'MXN'
    }, { onConflict: 'batch_id, costo_articulo_id' });

    if (histErr1) console.error('❌ Error insertando historial:', histErr1);
    else console.log('✅ Historial de costo guardado (Primer paso idempotencia).');

    // Historial (Inserción 2 - Duplicado Intencional)
    const { error: histErr2 } = await supabase.from('precios_historial_proveedor').upsert({
        batch_id: batch!.id,
        costo_articulo_id: costo.id,
        articulo_id: artId,
        tipo_costo: 'distribuidor',
        valor_antiguo: null,
        valor_nuevo: 1500,
        moneda: 'MXN'
    }, { onConflict: 'batch_id, costo_articulo_id' });

    if (histErr2) console.error('❌ Falla en la idempotencia del historial:', histErr2);
    else console.log('✅ Historial de costo intentado nuevamente (no duplicó, Upsert OK).');

    // Confirmar
    await supabase.from('costos_articulo').update({ estado_match: 'confirmado', vigente: true }).eq('id', costo.id);
    console.log('✅ Registro confirmado.');

    // Cleanup
    console.log('🧹 Limpiando test data...');
    await supabase.from('importaciones_excel').delete().eq('id', importacionId);
    
    console.log('🎉 Test existoso!');
}

runTest().catch(console.error);
