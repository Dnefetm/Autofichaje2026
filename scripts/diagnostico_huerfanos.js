/**
 * Diagnóstico de Huérfanos en ingresos/egresos
 * Paso 1 del plan de ejecución.
 * 
 * Verifica que todos los articulo_id en ingresos y egresos 
 * existan como PK en la tabla articulos.
 * 
 * Ejecutar: node scripts/diagnostico_huerfanos.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function diagnosticarHuerfanos() {
    console.log('=== DIAGNÓSTICO DE HUÉRFANOS ===\n');

    // 1. Huérfanos en INGRESOS
    console.log('--- Verificando INGRESOS ---');
    const { data: ingresosOrfanos, error: errIng } = await supabase.rpc('exec_sql', {
        query: `
            SELECT DISTINCT i.articulo_id, COUNT(*) as filas
            FROM ingresos i
            LEFT JOIN articulos a ON i.articulo_id = a.articulo_id
            WHERE a.articulo_id IS NULL
              AND i.articulo_id IS NOT NULL
            GROUP BY i.articulo_id
            ORDER BY filas DESC
            LIMIT 50
        `
    });

    if (errIng) {
        // Si no existe la función RPC, usar query directa via PostgREST
        console.log('RPC no disponible. Usando método alternativo...');
        
        // Alternativa: obtener total de ingresos y comparar con los que tienen FK válida
        const { count: totalIngresos } = await supabase
            .from('ingresos')
            .select('*', { count: 'exact', head: true });

        const { count: ingresosConArticulo } = await supabase
            .from('ingresos')
            .select('*, articulos!inner(articulo_id)', { count: 'exact', head: true });

        const huerfanosIng = (totalIngresos || 0) - (ingresosConArticulo || 0);
        console.log(`  Total ingresos: ${totalIngresos}`);
        console.log(`  Con artículo válido: ${ingresosConArticulo}`);
        console.log(`  HUÉRFANOS: ${huerfanosIng}`);
        
        if (huerfanosIng > 0) {
            // Obtener muestra de huérfanos
            console.log('\n  Muestra de IDs huérfanos (primeros 20):');
            const { data: muestra } = await supabase
                .from('ingresos')
                .select('articulo_id')
                .not('articulo_id', 'is', null)
                .limit(1000);
            
            if (muestra) {
                // Verificar cada uno
                const uniqueIds = [...new Set(muestra.map(m => m.articulo_id))];
                const { data: validos } = await supabase
                    .from('articulos')
                    .select('articulo_id')
                    .in('articulo_id', uniqueIds.slice(0, 100));
                
                const validosSet = new Set((validos || []).map(v => v.articulo_id));
                const huerfanosList = uniqueIds.filter(id => !validosSet.has(id)).slice(0, 20);
                huerfanosList.forEach(id => console.log(`    - ${id}`));
            }
        }
    } else {
        if (ingresosOrfanos && ingresosOrfanos.length > 0) {
            console.log(`  ❌ Encontrados ${ingresosOrfanos.length} articulo_id huérfanos:`);
            ingresosOrfanos.forEach(h => console.log(`    - ${h.articulo_id} (${h.filas} filas)`));
        } else {
            console.log('  ✅ Sin huérfanos en ingresos');
        }
    }

    // 2. Huérfanos en EGRESOS
    console.log('\n--- Verificando EGRESOS ---');
    const { count: totalEgresos } = await supabase
        .from('egresos')
        .select('*', { count: 'exact', head: true });

    const { count: egresosConArticulo } = await supabase
        .from('egresos')
        .select('*, articulos!inner(articulo_id)', { count: 'exact', head: true });

    const huerfanosEgr = (totalEgresos || 0) - (egresosConArticulo || 0);
    console.log(`  Total egresos: ${totalEgresos}`);
    console.log(`  Con artículo válido: ${egresosConArticulo}`);
    console.log(`  HUÉRFANOS: ${huerfanosEgr}`);

    if (huerfanosEgr > 0) {
        console.log('\n  Muestra de IDs huérfanos (primeros 20):');
        const { data: muestra } = await supabase
            .from('egresos')
            .select('articulo_id')
            .not('articulo_id', 'is', null)
            .limit(1000);
        
        if (muestra) {
            const uniqueIds = [...new Set(muestra.map(m => m.articulo_id))];
            const { data: validos } = await supabase
                .from('articulos')
                .select('articulo_id')
                .in('articulo_id', uniqueIds.slice(0, 100));
            
            const validosSet = new Set((validos || []).map(v => v.articulo_id));
            const huerfanosList = uniqueIds.filter(id => !validosSet.has(id)).slice(0, 20);
            huerfanosList.forEach(id => console.log(`    - ${id}`));
        }
    }

    // 3. Resumen
    console.log('\n=== RESUMEN ===');
    const totalHuerfanos = (huerfanosEgr || 0);
    if (totalHuerfanos === 0) {
        console.log('✅ SEGURO aplicar FK formales en ingresos/egresos hacia articulos.articulo_id');
    } else {
        console.log('⚠️  Hay huérfanos. Limpiar antes de aplicar FK formales.');
        console.log('    Opciones: DELETE filas huérfanas, o crear artículos placeholder.');
    }

    // 4. Estado de publicaciones_externas
    console.log('\n--- Estado de PUBLICACIONES_EXTERNAS ---');
    const { count: totalPubs } = await supabase
        .from('publicaciones_externas')
        .select('*', { count: 'exact', head: true });

    const { count: pubsMapeadas } = await supabase
        .from('publicaciones_externas')
        .select('*', { count: 'exact', head: true })
        .eq('esta_mapeado', true);

    console.log(`  Total publicaciones: ${totalPubs}`);
    console.log(`  Mapeadas: ${pubsMapeadas || 0}`);
    console.log(`  Sin mapear: ${(totalPubs || 0) - (pubsMapeadas || 0)}`);
}

diagnosticarHuerfanos().catch(console.error);
