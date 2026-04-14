/**
 * GET /api/precios/importar/[id]/preview
 *
 * Lee el Excel desde Supabase Storage y devuelve:
 *   - headers: string[]          — nombres de columnas (fila 1)
 *   - rows: string[][]           — primeras 10 filas de datos
 *   - total_rows: number         — total estimado de filas
 *   - mapeo_previo: object|null  — si el proveedor ya tiene un mapeo guardado
 *   - tipo_costo_previo: string|null
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import ExcelJS from 'exceljs';

export const dynamic = 'force-dynamic';

const PREVIEW_ROWS = 10;

export async function GET(
    _req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const { id } = await props.params;

    // ── Obtener registro de importación ─────────────────────────────────────
    const { data: importacion, error: fetchErr } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, nombre_archivo, proveedor, mapeo_columnas, tipo_costo_default, estado')
        .eq('id', id)
        .single();

    if (fetchErr || !importacion) {
        return NextResponse.json(
            { ok: false, error: 'Importación no encontrada' },
            { status: 404 }
        );
    }

    const mapeo = importacion.mapeo_columnas as Record<string, any> | null;
    const storagePath = mapeo?._storage_path as string | undefined;
    const bucket = (mapeo?._bucket as string | undefined) || 'excel-precios';

    if (!storagePath) {
        return NextResponse.json(
            { ok: false, error: 'No hay archivo asociado a esta importación' },
            { status: 422 }
        );
    }

    // ── Descargar archivo desde Storage ─────────────────────────────────────
    const { data: fileData, error: downloadErr } = await supabaseAdmin.storage
        .from(bucket)
        .download(storagePath);

    if (downloadErr || !fileData) {
        return NextResponse.json(
            { ok: false, error: `No se pudo leer el archivo: ${downloadErr?.message}` },
            { status: 500 }
        );
    }

    // ── Parsear Excel con exceljs ────────────────────────────────────────────
    const arrayBuffer = await fileData.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);

    const sheet = workbook.worksheets[0];
    if (!sheet) {
        return NextResponse.json(
            { ok: false, error: 'El archivo Excel no contiene hojas de cálculo' },
            { status: 422 }
        );
    }

    const allRows: any[][] = [];
    sheet.eachRow((row) => {
        const values = (row.values as any[]).slice(1); // exceljs usa índice 1-based, slice(1) quita el primer null
        allRows.push(values.map((v) => {
            if (v === null || v === undefined) return '';
            if (typeof v === 'object' && 'result' in v) return String(v.result); // fórmulas
            if (typeof v === 'object' && 'text' in v) return String(v.text);     // rich text
            return String(v);
        }));
    });

    if (allRows.length === 0) {
        return NextResponse.json(
            { ok: false, error: 'El archivo Excel está vacío' },
            { status: 422 }
        );
    }

    const headers = allRows[0] ?? [];
    const dataRows = allRows.slice(1, PREVIEW_ROWS + 1);
    const totalRows = Math.max(0, allRows.length - 1); // excluir header

    // El mapeo previo se filtra para no exponer la metadata interna de storage
    const mapeoPrevio = mapeo
        ? Object.fromEntries(
            Object.entries(mapeo).filter(([k]) => !k.startsWith('_'))
        )
        : null;

    return NextResponse.json({
        ok: true,
        importacion_id: id,
        nombre_archivo: importacion.nombre_archivo,
        proveedor: importacion.proveedor,
        headers,
        rows: dataRows,
        total_rows: totalRows,
        mapeo_previo: Object.keys(mapeoPrevio ?? {}).length > 0 ? mapeoPrevio : null,
        tipo_costo_previo: importacion.tipo_costo_default ?? null,
    });
}
