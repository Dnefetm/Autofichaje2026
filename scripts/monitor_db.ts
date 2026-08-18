import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Cargar env de dashboard
dotenv.config({ path: path.resolve(__dirname, '../apps/dashboard/.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function monitor() {
    console.log("=== INICIANDO MONITOREO DE BD (PRECIOS) ===");
    
    // Ultima importacion
    const { data: imp, error: errImp } = await supabase
        .from('importaciones_excel')
        .select('*')
        .order('creado_el', { ascending: false })
        .limit(1)
        .single();
    
    if (errImp || !imp) {
        console.error("No hay importaciones.");
        return;
    }
    
    console.log(`\nImportación Actual: ${imp.id} | Estado: ${imp.estado}`);
    
    // Verificar colas en matching_jobs
    const { data: job } = await supabase
        .from('matching_jobs')
        .select('estado, progreso, total_filas, finalizado_el')
        .eq('importacion_id', imp.id)
        .single();
        
    console.log(`Cola (matching_jobs):`, job ? job : "Sin cola asignada");
    
    // Verificar filas insertadas en historico
    const { count: rawCount } = await supabase
        .from('listas_precios_raw')
        .select('*', { count: 'exact', head: true })
        .eq('importacion_id', imp.id);
        
    console.log(`Filas Raw Histórico: ${rawCount}`);
    
    // Verificar filas insertadas en staging
    const { count: stagingCount } = await supabase
        .from('listas_precios_raw_staging')
        .select('*', { count: 'exact', head: true })
        .eq('importacion_id', imp.id);
        
    console.log(`Filas Raw Staging: ${stagingCount}`);
    
    // Verificar costos insertados
    const { count: costosCount } = await supabase
        .from('costos_articulo')
        .select('*', { count: 'exact', head: true })
        .eq('importacion_id', imp.id);
        
    console.log(`Nuevos Costos Articulo Mapeados: ${costosCount}`);
    
    // Errores en importacion
    if (imp.estado === 'error') {
        console.log(`LOG ERROR:`, imp.log_errores);
    }
}

monitor();
