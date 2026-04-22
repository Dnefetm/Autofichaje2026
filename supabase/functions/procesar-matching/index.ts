import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const CHUNK_SIZE = 500;
const MAX_EXECUTION_TIME_MS = 45000; // 45 segundos de wall-clock máximo

async function pickNext(): Promise<string | null> {
  const { data, error } = await sb.from('matching_jobs')
    .update({ estado: 'corriendo', iniciado_el: new Date().toISOString() })
    .eq('estado', 'pendiente')
    .select('id')
    .limit(1)
    .single();
    
  if (error || !data) return null;
  return data.id;
}

async function emitEvent(importacion_id: string, estado_paso: string, mensaje: string) {
  await sb.from('importacion_eventos').insert({
    importacion_id,
    estado_paso,
    mensaje
  });
}

async function procesarMatching(jobId: string) {
  const startTime = performance.now();
  
  const { data: job, error: jobErr } = await sb.from('matching_jobs').select('*').eq('id', jobId).single();
  if (!job) throw new Error('Job no encontrado');

  const { data: imp } = await sb.from('importaciones_excel').select('*').eq('id', job.importacion_id).single();
  if (!imp) throw new Error('Importación no encontrada');
  
  await sb.from('matching_jobs').update({ total: imp.total_filas }).eq('id', jobId);

  let procesadas = job.progreso || 0;
  let offset = procesadas;
  let hasMore = true;

  await emitEvent(job.importacion_id, 'MATCHING_INICIADO', `Iniciando motor de matching desde fila ${offset}...`);

  while(hasMore) {
     // 1. Defensa contra timeout: Si superamos el límite de tiempo, pausamos y nos re-encolamos
     if (performance.now() - startTime > MAX_EXECUTION_TIME_MS) {
        await sb.from('matching_jobs').update({ 
            estado: 'pendiente', 
            progreso: offset 
        }).eq('id', jobId);
        
        await emitEvent(job.importacion_id, 'MATCHING_PAUSADO', `Pausando para evadir timeout. Progreso guardado: ${offset}/${imp.total_filas}`);
        
        // Auto re-invocación asíncrona (fire and forget)
        sb.functions.invoke('procesar-matching').catch(console.error);
        
        return false; // Indica que no ha terminado, pero salió para no morir.
     }

     // 2. Invocar el RPC Set-Based con LATERAL JOIN
     const { data: rowsProcessed, error: rpcErr } = await sb.rpc('fn_match_precios_chunk', {
         p_importacion_id: job.importacion_id,
         p_offset: offset,
         p_limit: CHUNK_SIZE
     });

     if (rpcErr) {
        throw new Error(`Fallo en RPC bloque ${offset}: ${rpcErr.message}`);
     }

     // 3. Emitir evento para el Polling del Frontend
     await emitEvent(job.importacion_id, 'MATCHING_PROGRESO', `Evaluando bloque. Progreso total: ${offset + CHUNK_SIZE} filas...`);

     // 4. Si el RPC se ejecutó bien, continuamos sumando offset. 
     // El offset se maneja por paginación del origen (listas_precios_raw)
     offset += CHUNK_SIZE;
     procesadas += (rowsProcessed || 0); // rowsProcessed son los costos insertados, no avance crudo
     
     await sb.from('matching_jobs').update({ progreso: offset }).eq('id', jobId);
     
     if (offset >= imp.total_filas) {
        hasMore = false;
     }
  }

  // Cierre exitoso de toda la importación
  await sb.from('matching_jobs').update({ 
      estado: 'completado', 
      progreso: offset,
      finalizado_el: new Date().toISOString() 
  }).eq('id', jobId);

  await emitEvent(job.importacion_id, 'MATCHING_COMPLETO', `Matching completado. Filas evaluadas con éxito.`);
  
  // Liberar el estado de importación general para el UI
  await sb.from('importaciones_excel').update({ 
      estado: 'matching_completo',
      ultima_actividad: new Date().toISOString()
  }).eq('id', job.importacion_id);

  return true; // Terminó completo
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok');

  try {
    for (let i = 0; i < 5; i++) {
      const id = await pickNext();
      if (!id) break;
      
      try { 
        const finished = await procesarMatching(id); 
        // Si no terminó (se pausó por timeout), salimos del loop para no quemar el tiempo del handler
        if (!finished) break;
      }
      catch (e: any) {
        await sb.from('matching_jobs').update({
          estado: 'error', 
          error: String(e?.message ?? e),
          finalizado_el: new Date().toISOString()
        }).eq('id', id);

        // Intentar emitir el error para el frontend
        const { data: job } = await sb.from('matching_jobs').select('importacion_id').eq('id', id).single();
        if (job) {
            await emitEvent(job.importacion_id, 'ERROR_MATCHING', String(e?.message ?? e));
            await sb.from('importaciones_excel').update({ estado: 'error', error_mensaje: String(e?.message ?? e) }).eq('id', job.importacion_id);
        }
      }
    }
    return new Response(JSON.stringify({ ok: true }), { headers: {'Content-Type': 'application/json'} });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), { status: 500, headers: {'Content-Type': 'application/json'} });
  }
});
