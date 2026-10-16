// =============================================================================
// procesar-importacion — parsea el Excel FUERA de Vercel (en Supabase Edge).
// REFACTOR: usa exceljs en modo STREAM (WorkbookReader) para no cargar todo el
// archivo en memoria. Un .xlsx de 4.65 MB se descomprime a ~100-150 MB de XML;
// con SheetJS (carga total) reventaba el límite de 256 MB de la Edge Function.
// Con streaming, la memoria se mantiene plana (solo el chunk actual en RAM).
//
// Flujo:
//   1. Valida estado 'pendiente_mapeo' y lo pasa a 'mapeando'.
//   2. Descarga el Excel de Storage.
//   3. Lee el Excel en streaming (exceljs WorkbookReader) y escribe a raw en
//      chunks de 2000 filas, filtrando por columnas_a_guardar.
//   4. Aplica vigencia en listas_precios_proveedor.
//   5. Setea total_filas/filas_procesadas y estado 'pendiente_mapeo'.
// =============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { Readable } from 'node:stream';
import { Buffer } from 'node:buffer';
import ExcelJS from 'npm:exceljs@4.4.0';

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

    await logEvento(id, 'DESCARGADO', 'Excel descargado. Iniciando parseo en streaming (exceljs).');

    // 3. Parsear en STREAMING (exceljs WorkbookReader) — memoria plana.
    //    Convertimos el archivo a un stream Node (un solo chunk) sin depender de
    //    Readable.fromWeb; exceljs lo lee incrementalmente por dentro.
    const buf = Buffer.from(await file.arrayBuffer());
    const stream = Readable.from([buf]);
    const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(stream);

    // Limpieza idempotente
    await sb.from('listas_precios_raw').delete().eq('importacion_id', id);

    // La lista RAW se guarda FIEL: todas las columnas, celdas vacías incluidas.
    // columnas_a_guardar se respeta aguas abajo (fn_procesar_precios_proveedor → columnas jsonb).

    const filaEncabezado = (typeof m.fila_encabezado === 'number' && m.fila_encabezado >= 0) ? m.fila_encabezado : 0;
    const omitirRepetidos = m.omitir_encabezados_repetidos !== false;
    const COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

    let chunk: any[] = [];
    let totalProcesadas = 0;

    for await (const worksheet of workbookReader) {
      const headers: string[] = [];
      let headerSnapshot: string[] = [];
      let filaNum = 0;
      let rowIndex = 0;

      for await (const row of worksheet) {
        const values: any[] = (row as any).values || [];

        // Omitir filas antes del encabezado configurado (portada / índice)
        if (rowIndex < filaEncabezado) { rowIndex++; continue; }

        // Fila de encabezado: nombrar columnas sin título por letra (col_A, col_B…)
        if (headers.length === 0) {
          for (let c = 1; c < values.length; c++) {
            const raw = String(values[c] ?? '').trim();
            const letra = COLS[c - 1] ?? `C${c}`;
            headers.push(raw !== '' ? raw : `col_${letra}`);
          }
          headerSnapshot = [...headers];
          rowIndex++;
          continue;
        }

        // Fila de datos: payload FIEL (todas las columnas, celdas vacías incluidas)
        const payload: Record<string, string> = {};
        const colsUsadas: string[] = [];
        let nonEmpty = 0;
        for (let c = 0; c < headers.length; c++) {
          const h = headers[c];
          const valStr = String(values[c + 1] ?? '').trim();
          payload[h] = valStr;
          colsUsadas.push(h);
          if (valStr !== '') nonEmpty++;
        }

        // Omitir encabezado repetido por sección (misma fila que el encabezado)
        if (omitirRepetidos) {
          let coincidencias = 0;
          let noVaciosHeader = 0;
          for (let i = 0; i < headers.length; i++) {
            if (headerSnapshot[i] !== '') {
              noVaciosHeader++;
              if (payload[headers[i]] === headerSnapshot[i]) coincidencias++;
            }
          }
          if (noVaciosHeader >= 2 && coincidencias === noVaciosHeader) { rowIndex++; continue; }
        }

        // Saltar filas casi vacías (títulos de sección, filas sin datos)
        if (nonEmpty < 3) { rowIndex++; continue; }

        filaNum++;
        totalProcesadas++;
        chunk.push({
          importacion_id: id,
          proveedor,
          fila_num: filaNum,
          payload,
          columnas_guardadas: colsUsadas,
        });

        if (chunk.length >= CHUNK_SIZE) {
          const { error } = await sb.from('listas_precios_raw').insert(chunk);
          if (error) throw new Error(`Fallo insertando a raw: ${error.message}`);
          chunk = [];
          await new Promise((r) => setTimeout(r, 5));
        }
        rowIndex++;
      }
      break; // solo la primera hoja
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
