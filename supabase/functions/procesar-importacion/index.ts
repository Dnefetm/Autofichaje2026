// =============================================================================
// procesar-importacion — parsea el Excel FUERA de Vercel (en Supabase Edge).
// Espeja exactamente el comportamiento del route `iniciar-parser` (el flujo
// vigente que hoy corre en Vercel), pero aquí el CPU del parseo NO cuenta
// contra Vercel.
//
// Flujo (idéntico al route actual):
//   1. Valida estado 'pendiente_mapeo' y lo pasa a 'mapeando'.
//   2. Descarga el Excel de Storage y lo parsea (SheetJS dense).
//   3. Escribe filas limpias a listas_precios_raw (chunks de 2000).
//   4. Aplica vigencia en listas_precios_proveedor.
//   5. Setea total_filas/filas_procesadas y estado 'pendiente_mapeo'.
// =============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as XLSX from 'npm:xlsx@0.18.5';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const CHUNK_SIZE = 2000;

async function logEvento(importacionId: string, estadoPaso: string, mensaje: string) {
  await sb.from('importacion_eventos').insert({
    importacion_id: importacionId,
    estado_paso: estadoPaso,
    mensaje,
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok');

  let id = '';
  try {
    const body = await req.json();
    id = body.importacion_id;
    if (!id) return new Response('No importacion_id', { status: 400 });

    // 1. Validar importación y estado
    const { data: imp, error: fetchErr } = await sb
      .from('importaciones_excel')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchErr || !imp) return new Response('Importación no encontrada', { status: 404 });
    if (imp.estado !== 'pendiente_mapeo') {
      return new Response(`Estado actual invalido: ${imp.estado}`, { status: 400 });
    }

    await sb.from('importaciones_excel').update({
      estado: 'mapeando',
      ultima_actividad: new Date().toISOString(),
    }).eq('id', id);

    const m = imp.mapeo_columnas || {};
    const path = m._storage_path || imp.nombre_archivo;
    const bucket = m._bucket ?? 'excel-precios';
    const proveedor = imp.proveedor;

    if (!path) throw new Error('No se encontró el path del archivo en la configuración');

    await logEvento(id, 'INICIO', 'Iniciando descarga y procesamiento del Excel en Supabase Edge Function.');

    // 2. Descargar
    const { data: file } = await sb.storage.from(bucket).download(path);
    if (!file) throw new Error('No se pudo descargar el Excel asociado a la importación');

    await logEvento(id, 'DESCARGADO', 'Excel descargado. Iniciando parseo ligero en memoria.');

    // 3. Parsear (mismo SheetJS; dense para ahorrar memoria)
    const buf = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'buffer', dense: true, cellFormula: false, cellHTML: false, cellStyles: false, cellText: false });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    if (!sheet) throw new Error('No se encontró la hoja 1 en el Excel');

    const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
    if (allRows.length === 0) throw new Error('El Excel parece estar vacío');

    const headers: string[] = (allRows[0] || []).map(String);

    // Limpieza idempotente
    await sb.from('listas_precios_raw').delete().eq('importacion_id', id);

    const rawCols = m.columnas_a_guardar ?? m.columnasAGuardar ?? [];
    const usaTodas = !rawCols || rawCols.length === 0;
    const colGuardarSet = new Set(Array.isArray(rawCols) ? rawCols : []);

    let chunk: any[] = [];
    let totalProcesadas = 0;

    for (let i = 1; i < allRows.length; i++) {
      const vals = allRows[i] || [];
      if (vals.filter((s: any) => s !== undefined && s !== null && String(s).trim() !== '').length < 3) continue;

      const payload: Record<string, string> = {};
      const colsUsadas: string[] = [];
      headers.forEach((h, idx) => {
        const valStr = String(vals[idx] ?? '').trim();
        if (usaTodas || colGuardarSet.has(h)) {
          payload[h] = valStr;
          colsUsadas.push(h);
        }
      });

      chunk.push({
        importacion_id: id,
        proveedor,
        fila_num: i,
        payload,
        columnas_guardadas: colsUsadas,
      });
      totalProcesadas++;

      if (chunk.length >= CHUNK_SIZE) {
        const { error } = await sb.from('listas_precios_raw').insert(chunk);
        if (error) throw new Error(`Fallo insertando a raw: ${error.message}`);
        chunk = [];
        await new Promise((r) => setTimeout(r, 5));
      }
    }

    if (chunk.length > 0) {
      const { error } = await sb.from('listas_precios_raw').insert(chunk);
      if (error) throw new Error(`Fallo final raw: ${error.message}`);
    }

    // 4. Vigencia: desactivar listas previas y activar la nueva
    await sb.from('listas_precios_proveedor')
      .update({ vigente: false, fecha_vigor_hasta: new Date().toISOString().split('T')[0] })
      .eq('proveedor', proveedor)
      .eq('vigente', true)
      .neq('importacion_id', id);

    await sb.from('listas_precios_proveedor').upsert({
      proveedor,
      importacion_id: id,
      vigente: true,
      fecha_vigor_desde: new Date().toISOString().split('T')[0],
      total_filas: totalProcesadas,
    }, { onConflict: 'importacion_id' });

    // 5. Estado final
    await sb.from('importaciones_excel').update({
      total_filas: totalProcesadas,
      filas_procesadas: totalProcesadas,
      estado: 'pendiente_mapeo',
      heartbeat_at: new Date().toISOString(),
    }).eq('id', id);

    await logEvento(id, 'RAW_COMPLETO', `Se guardaron ${totalProcesadas} filas en el catálogo crudo del proveedor.`);

    return new Response(JSON.stringify({ ok: true, total_filas: totalProcesadas }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (id) {
      try {
        await sb.from('importaciones_excel').update({
          estado: 'error',
          error_mensaje: msg,
          ultima_actividad: new Date().toISOString(),
        }).eq('id', id);
      } catch (_) { /* no-op */ }
    }
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
