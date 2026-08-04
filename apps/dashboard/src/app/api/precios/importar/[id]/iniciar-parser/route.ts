/**
 * POST /api/precios/importar/[id]/iniciar-parser
 *
 * 1. Setea el estado de la importación a 'mapeando'.
 * 2. Invoca la Edge Function 'procesar-importacion' para que lea el Excel y calcule el diff.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function logEvento(sb: any, importacionId: string, estadoPaso: string, mensaje: string) {
  await sb.from('importacion_eventos').insert({
    importacion_id: importacionId,
    estado_paso: estadoPaso,
    mensaje
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const { id } = await props.params;

    const { data: imp, error: fetchErr } = await supabaseAdmin
        .from('importaciones_excel')
        .select('*')
        .eq('id', id)
        .single();

    if (fetchErr || !imp) {
        return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 });
    }

    if (imp.estado !== 'pendiente_mapeo') {
        return NextResponse.json({ ok: false, error: `Estado actual invalido: ${imp.estado}` }, { status: 400 });
    }

    const { error: updateErr } = await supabaseAdmin
        .from('importaciones_excel')
        .update({
            estado: 'mapeando',
            ultima_actividad: new Date().toISOString(),
        })
        .eq('id', id);

    // Instead of invoking Edge Function, parse it here in Next.js Serverless (has 1024MB Memory)
    try {
        const m = imp.mapeo_columnas || {};
        const path = m._storage_path || imp.archivo_path;
        const bucket = m._bucket ?? 'excel-precios';
        const proveedor = imp.proveedor;

        if (!path) throw new Error('No se encontró el path del archivo en la configuración');

        await logEvento(supabaseAdmin, id, 'INICIO', 'Iniciando descarga y procesamiento de Excel plano en Next.js Serverless.');

        const { data: file } = await supabaseAdmin.storage.from(bucket).download(path);
        if (!file) throw new Error('No se pudo descargar Excel asociado a la importación');

        await logEvento(supabaseAdmin, id, 'DESCARGADO', 'Excel local descargado. Iniciando parseo ligero en memoria.');


        const buf = new Uint8Array(await file.arrayBuffer());
        // Removing cellFormula: false, cellHTML: false, etc. to ensure we capture everything, including formula evaluations.
        const wb = XLSX.read(buf, { type: 'buffer', dense: true });
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        
        if (!sheet) throw new Error('No se encontro hoja 1 en el Excel');

        const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        
        if (allRows.length === 0) throw new Error('El excel parece estar vacio');

        const headers: string[] = allRows[0]?.map(String) ?? [];
        let chunk: any[] = [];
        let totalProcesadas = 0;

        // Limpieza Idempotente para prevenir duplicados si reintenta
        await supabaseAdmin.from('listas_precios_raw_staging').delete().eq('importacion_id', id);

        const rawCols = m.columnas_a_guardar ?? m.columnasAGuardar ?? [];
        const usaTodas = !rawCols || rawCols.length === 0;
        const colGuardarSet = new Set(Array.isArray(rawCols) ? rawCols : []);
        
        // Candado Anti "0 filas": validar columnas mapeadas
        const missingCols: string[] = [];
        if (m.columna_modelo && !headers.includes(m.columna_modelo)) missingCols.push(m.columna_modelo);
        if (m.columna_codigo && !headers.includes(m.columna_codigo)) missingCols.push(m.columna_codigo);
        if (Array.isArray(m.precios)) {
            m.precios.forEach((p: any) => {
                if (p.columna && !headers.includes(p.columna)) missingCols.push(p.columna);
            });
        }
        
        if (missingCols.length > 0) {
            const errStr = `Faltan columnas mapeadas en el Excel: ${missingCols.join(', ')}`;
            await logEvento(supabaseAdmin, id, 'ERROR', errStr);
            return NextResponse.json({ ok: false, error: errStr }, { status: 400 });
        }
        
        for (let i = 1; i < allRows.length; i++) {
            const vals = allRows[i].map((v: any) => String(v ?? '').trim());       if (vals.filter((s: string) => s !== '').length < 3) continue;
            const payload: Record<string, string> = {};
            const colsUsadas: string[] = [];
            headers.forEach((h, idx) => {
                if (usaTodas || colGuardarSet.has(h)) {
                    payload[h] = vals[idx];
                    colsUsadas.push(h);
                }
            });

            chunk.push({
                importacion_id: id,
                proveedor: proveedor,
                fila_num: i,
                payload: payload,
                columnas_guardadas: colsUsadas
            });
            totalProcesadas++;

            if (chunk.length >= 5000) {
                const { error } = await supabaseAdmin.from('listas_precios_raw_staging').insert(chunk);
                if (error) throw new Error(`Fallo insertando a staging: ${error.message}`);
                chunk = [];
            }
        }

        if (chunk.length > 0) {
            const { error } = await supabaseAdmin.from('listas_precios_raw_staging').insert(chunk);
            if (error) throw new Error(`Fallo final staging: ${error.message}`);
        }

        // SET TOTAL FILAS!
        await supabaseAdmin.from('importaciones_excel').update({
             total_filas: totalProcesadas,
             filas_procesadas: totalProcesadas,
             heartbeat_at: new Date().toISOString()
        }).eq('id', id);

        await logEvento(supabaseAdmin, id, 'STAGING_COMPLETO', `Se volcaron ${totalProcesadas} filas planas en cuarentena. Calculando diferencias DB.`);

        const { error: rpcErr } = await supabaseAdmin.rpc('fn_preparar_importacion_revision', {
            p_importacion_id: id,
            p_proveedor: proveedor
        });

        if (rpcErr) throw new Error(`Fallo calculo de Diff RPC: ${rpcErr.message}`);

        await logEvento(supabaseAdmin, id, 'COMPLETADO', 'Diff calculado. Listo para revisión manual.');

    } catch (e: any) {
        console.error("Error Parseando:", e);
        const msg = String(e?.message ?? e);
        await supabaseAdmin.from('importaciones_excel').update({ estado: 'error', error_mensaje: msg, ultima_actividad: new Date().toISOString() }).eq('id', id);
        return NextResponse.json({ ok: false, error: "Parser Falló: " + msg }, { status: 500 });
    }

    return NextResponse.json({ ok: true, estado: 'mapeando' }, { status: 202 });
}
