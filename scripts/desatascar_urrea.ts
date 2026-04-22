import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltan variables de entorno SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function main() {
    console.log('Buscando importación atascada de Urrea...');

    // 1. Buscar la importación
    const { data: importacion, error: impErr } = await sb
        .from('importaciones_excel')
        .select('*')
        .eq('proveedor', 'Urrea Herramientas')
        .in('estado', ['en_revision', 'mapeando'])
        .order('creado_el', { ascending: false })
        .limit(1)
        .single();

    if (impErr || !importacion) {
        console.log('No se encontró ninguna importación atascada de Urrea.');
        return;
    }

    console.log(`Importación encontrada: ${importacion.id} (Estado: ${importacion.estado})`);

    // 2. Buscar el matching job asociado
    const { data: job, error: jobErr } = await sb
        .from('matching_jobs')
        .select('*')
        .eq('importacion_id', importacion.id)
        .order('creado_el', { ascending: false })
        .limit(1)
        .single();

    if (jobErr || !job) {
        console.log('No se encontró un matching_job asociado. No se puede continuar.');
        return;
    }

    console.log(`Matching Job encontrado: ${job.id} (Estado: ${job.estado}, Progreso: ${job.progreso}/${job.total})`);

    // 3. Procesar en chunks manualmente
    let offset = job.progreso || 0;
    const CHUNK_SIZE = 500;
    let hasMore = true;

    console.log('Iniciando procesamiento manual usando el nuevo RPC fn_match_precios_chunk...');

    while (hasMore) {
        console.log(`Llamando RPC offset ${offset}...`);
        const { data: procesadas, error: rpcErr } = await sb.rpc('fn_match_precios_chunk', {
            p_importacion_id: importacion.id,
            p_offset: offset,
            p_limit: CHUNK_SIZE
        });

        if (rpcErr) {
            console.error('Error en RPC:', rpcErr);
            break;
        }

        console.log(`  -> Insertadas/Procesadas ${procesadas} filas.`);
        
        offset += CHUNK_SIZE;
        
        // Emitir evento para UI
        await sb.from('importacion_eventos').insert({
            importacion_id: importacion.id,
            estado_paso: 'MATCHING_PROGRESO_MANUAL',
            mensaje: `Recuperación manual: Progreso ${offset} filas evaluadas.`
        });

        // Actualizar progreso
        await sb.from('matching_jobs').update({ progreso: offset }).eq('id', job.id);

        if (offset >= importacion.total_filas || procesadas === 0) {
            hasMore = false;
        }
    }

    console.log('Matching completo. Actualizando estados finales...');

    // 4. Cerrar
    await sb.from('matching_jobs').update({ estado: 'completado', progreso: offset }).eq('id', job.id);
    await sb.from('importaciones_excel').update({ estado: 'matching_completo' }).eq('id', importacion.id);

    await sb.from('importacion_eventos').insert({
        importacion_id: importacion.id,
        estado_paso: 'MATCHING_COMPLETO',
        mensaje: `Matching recuperado y completado manualmente.`
    });

    console.log('¡Urrea desbloqueado con éxito!');
}

main().catch(console.error);
