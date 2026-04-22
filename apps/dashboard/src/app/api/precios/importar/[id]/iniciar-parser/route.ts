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

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const { id } = await props.params;

    const { data: imp, error: fetchErr } = await supabaseAdmin
        .from('importaciones_excel')
        .select('estado')
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

        const { data: file } = await supabaseAdmin.storage.from(bucket).download(path);
        if (!file) throw new Error('No se pudo descargar Excel asociado a la importación');

        const buf = new Uint8Array(await file.arrayBuffer());
        const wb = XLSX.read(buf, { type: 'buffer', dense: true, cellFormula: false, cellHTML: false, cellStyle: false, cellText: false });
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        
        if (!sheet) throw new Error('No se encontro hoja 1 en el Excel');

        const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        
        if (allRows.length === 0) throw new Error('El excel parece estar vacio');

        const headers: string[] = allRows[0]?.map(String) ?? [];
        let chunk: any[] = [];
        let totalProcesadas = 0;

        const rawCols = m.columnas_a_guardar ?? m.columnasAGuardar ?? [];
        const usaTodas = !rawCols || rawCols.length === 0;
        const colGuardarSet = new Set(Array.isArray(rawCols) ? rawCols : []);
        
        for (let i = 1; i < allRows.length; i++) {
            const vals = allRows[i].map((v: any) => String(v ?? '').trim());
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

        const { error: rpcErr } = await supabaseAdmin.rpc('fn_preparar_importacion_revision', {
            p_importacion_id: id,
            p_proveedor: proveedor
        });

        if (rpcErr) throw new Error(`Fallo calculo de Diff RPC: ${rpcErr.message}`);

    } catch (e: any) {
        console.error("Error Parseando:", e);
        const msg = String(e?.message ?? e);
        await supabaseAdmin.from('importaciones_excel').update({ estado: 'error', error_mensaje: msg, ultima_actividad: new Date().toISOString() }).eq('id', id);
        return NextResponse.json({ ok: false, error: "Parser Falló: " + msg }, { status: 500 });
    }

    return NextResponse.json({ ok: true, estado: 'mapeando' }, { status: 202 });
}
