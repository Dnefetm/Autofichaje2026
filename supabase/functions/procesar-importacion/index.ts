import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import ExcelJS from 'npm:exceljs@4.4.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const CHUNK_SIZE = 1000;

async function logEvento(importacionId: string, estadoPaso: string, mensaje: string) {
  await sb.from('importacion_eventos').insert({
    importacion_id: importacionId,
    estado_paso: estadoPaso,
    mensaje
  });
}

async function procesarImportacion(importacionId: string) {
  await logEvento(importacionId, 'INICIO', 'Iniciando descarga y procesamiento de Excel.');

  const { data: imp } = await sb.from('importaciones_excel').select('*').eq('id', importacionId).single();
  if (!imp) throw new Error('Importacion no encontrada');

  const m = imp.mapeo_columnas;
  const path = m._storage_path;
  const bucket = m._bucket ?? 'excel-precios';
  const proveedor = imp.proveedor;

  const { data: file } = await sb.storage.from(bucket).download(path);
  if (!file) {
     throw new Error('No se pudo descargar Excel asociado a la importación');
  }

  await logEvento(importacionId, 'DESCARGADO', 'Excel descargado exitosamente. Iniciando parseo.');

  const buf = new Uint8Array(await file.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheet = wb.worksheets[0];

  const headers: string[] = [];
  let chunk: any[] = [];
  let totalProcesadas = 0;

  async function flushChunk() {
    if (chunk.length === 0) return;
    const { error } = await sb.from('listas_precios_raw_staging').insert(chunk);
    if (error) throw new Error(`Fallo insertando a staging: ${error.message}`);
    
    // Heartbeat
    await sb.from('importaciones_excel').update({
       heartbeat_at: new Date().toISOString(),
       filas_procesadas: totalProcesadas,
       ultima_actividad: new Date().toISOString()
    }).eq('id', importacionId);
    
    chunk = [];
  }

  // Obtenemos las columnas a guardar (Raw mode) que se configuran en el wizard
  const colGuardarSet = new Set(m.columnasAGuardar ?? []);
  
  sheet.eachRow((row, i) => {
    const vals = (row.values as any[]).slice(1).map((v: any) => v?.result ?? v?.text ?? v ?? '');
    
    if (i === 1) { 
       headers.push(...vals.map(String)); 
       return; 
    }
    
    // Validar si pasa algun criterio basico
    const byHeader: Record<string, string> = {};
    headers.forEach((h, idx) => byHeader[h] = String(vals[idx] ?? '').trim());
    
    // Payload as jsonb
    const payload: Record<string, string> = {};
    const colsUsadas: string[] = [];
    headers.forEach((h, idx) => {
       if (colGuardarSet.has(h)) {
          payload[h] = byHeader[h];
          colsUsadas.push(h);
       }
    });

    chunk.push({
       importacion_id: importacionId,
       proveedor: proveedor,
       fila_num: i,
       payload: payload,
       columnas_guardadas: colsUsadas
    });
    totalProcesadas++;
  });

  // Ultimo chunk
  await flushChunk();

  await logEvento(importacionId, 'STAGING_COMPLETO', `Llenadas ${totalProcesadas} filas en staging. Consolidando.`);

  // Consolidar atómicamente
  const { error: rpcErr } = await sb.rpc('fn_consolidar_importacion', {
     p_importacion_id: importacionId,
     p_proveedor: proveedor
  });

  if (rpcErr) throw new Error(`Fallo consolidación RPC: ${rpcErr.message}`);

  await logEvento(importacionId, 'COMPLETADO', 'Lista de Precios Vigente establecida. Fin del proceso backend.');
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok');

  try {
    const body = await req.json();
    const id = body.importacion_id;
    if (!id) return new Response('No importacion_id', { status: 400 });

    try { 
      await procesarImportacion(id); 
    }
    catch (e: any) {
      const msg = String(e?.message ?? e);
      await logEvento(id, 'ERROR_FATAL', msg);
      
      await sb.from('importaciones_excel').update({
        estado: 'error', 
        error_mensaje: msg,
        ultima_actividad: new Date().toISOString(),
        heartbeat_at: new Date().toISOString()
      }).eq('id', id);
    }
    
    return new Response(JSON.stringify({ ok: true }), { headers: {'Content-Type': 'application/json'} });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), { status: 500, headers: {'Content-Type': 'application/json'} });
  }
});
