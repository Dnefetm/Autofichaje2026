import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as XLSX from 'npm:xlsx@0.18.5';

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
  await logEvento(importacionId, 'INICIO', 'Iniciando descarga y procesamiento de Excel plano.');

  const { data: imp } = await sb.from('importaciones_excel').select('*').eq('id', importacionId).single();
  if (!imp) throw new Error('Importacion no encontrada');

  const m = imp.mapeo_columnas || {};
  const path = m._storage_path || imp.archivo_path; // Fallback to schema if _storage_path missing
  const bucket = m._bucket ?? 'excel-precios';
  const proveedor = imp.proveedor;

  if (!path) {
      throw new Error('No se encontró el path del archivo en la configuración');
  }

  const { data: file } = await sb.storage.from(bucket).download(path);
  if (!file) {
     throw new Error('No se pudo descargar Excel asociado a la importación');
  }

  await logEvento(importacionId, 'DESCARGADO', 'Excel local descargado. Iniciando parseo ultra-ligero (SheetJS).');

  const buf = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: 'buffer', cellFormula: false, cellHTML: false, cellStyle: false });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  
  if (!sheet) throw new Error('No se encontro hoja 1 en el Excel');

  const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  
  if (allRows.length === 0) throw new Error('El excel parece estar vacio');

  const headers: string[] = allRows[0]?.map(String) ?? [];
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

  // Obtenemos las columnas a guardar (Raw mode) que se configuraron la ULTIMA VEZ para el proveedor
  // O bien las que vienen en este chunk crudo. (Dado que el user no formatea esto si desacoplamos, usamos TODO el headers provisionalmente)
  let rawCols = m.columnas_a_guardar ?? m.columnasAGuardar ?? [];
  
  let usaTodas = false;
  if (!rawCols || rawCols.length === 0) {
      usaTodas = true;
  }
  const colGuardarSet = new Set(Array.isArray(rawCols) ? rawCols : []);
  
  for (let i = 1; i < allRows.length; i++) {
    const vals = allRows[i].map((v: any) => String(v ?? '').trim());
    
    // Payload as jsonb
    const payload: Record<string, string> = {};
    const colsUsadas: string[] = [];
    headers.forEach((h, idx) => {
       if (usaTodas || colGuardarSet.has(h)) {
          payload[h] = vals[idx];
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
    
    if (chunk.length >= CHUNK_SIZE) {
        await flushChunk();
    }
  }

  // Ultimo chunk
  await flushChunk();

  await logEvento(importacionId, 'STAGING_COMPLETO', `Se volcaron ${totalProcesadas} filas planas en cuarentena. Calculando diferencias DB.`);

  // Consolidar atómicamente la preparación del Diff  -> AQUI ESTÁ LA MAGIA DEL DESACOPLE
  const { error: rpcErr } = await sb.rpc('fn_preparar_importacion_revision', {
     p_importacion_id: importacionId,
     p_proveedor: proveedor
  });

  if (rpcErr) throw new Error(`Fallo calculo de Diff RPC: ${rpcErr.message}`);

  await logEvento(importacionId, 'COMPLETADO', 'Diff calculado. Listo para revisión manual.');
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
