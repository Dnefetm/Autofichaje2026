/**
 * PATCH /api/precios/importar/[id]/mapear
 *
 * 1. Guarda el mapeo de columnas en importaciones_excel.
 * 2. Lee el Excel completo desde Storage.
 * 3. Para cada fila llama a la RPC `fn_match_articulo_proveedor` en Postgres
 *    que usa pg_trgm (índice GIN). Lógica de prioridad:
 *      a) Match exacto por código_excel → score 100, metodo 'codigo_exacto'
 *      b) Fuzzy similarity(marca_excel + modelo_excel, marca + modelo) → score 0-100
 * 4. Inserta en costos_articulo con trazabilidad completa (modelo_excel, marca_excel, codigo_excel).
 * 5. Actualiza estado → 'en_revision'.
 *
 * Body:
 * {
 *   columna_modelo:  string,   // obligatoria — identificador de producto
 *   columna_marca:   string,   // obligatoria — marca del proveedor
 *   columna_precio:  string,   // obligatoria
 *   columna_codigo?: string,   // opcional   — UPC/EAN/código universal
 *   columna_moneda?: string,   // opcional
 *   tipo_costo:      string,   // obligatoria
 *   moneda_default?: string,   // default 'MXN'
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import ExcelJS from 'exceljs';

export const dynamic = 'force-dynamic';

// Llamadas concurrentes al RPC (sin saturar Supabase)
const CONCURRENCY = 20;
// Umbral mínimo de score para considerar como 'sugerido' (en lugar de 'sin_match')
const SCORE_UMBRAL = 40;

/** Extrae el valor de celda como string limpio */
function cellToString(v: any): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object' && 'result' in v) return String(v.result ?? '');
    if (typeof v === 'object' && 'text' in v) return String(v.text ?? '');
    return String(v);
}

/** Ejecuta promesas en paralelo con límite de concurrencia */
async function pMap<T, R>(
    items: T[],
    fn: (item: T, i: number) => Promise<R>,
    concurrency: number
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let idx = 0;

    async function worker() {
        while (idx < items.length) {
            const i = idx++;
            results[i] = await fn(items[i], i);
        }
    }

    await Promise.all(Array.from({ length: concurrency }, worker));
    return results;
}

export async function PATCH(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const { id } = await props.params;

    const body = await req.json().catch(() => null);
    const { columna_modelo, columna_marca, columna_precio, columna_codigo,
        columna_moneda, tipo_costo, moneda_default = 'MXN' } = body ?? {};

    if (!columna_modelo || !columna_marca || !columna_precio || !tipo_costo) {
        return NextResponse.json(
            { ok: false, error: 'Se requieren: columna_modelo, columna_marca, columna_precio, tipo_costo' },
            { status: 400 }
        );
    }

    // ── Obtener la importación ───────────────────────────────────────────────
    const { data: importacion, error: fetchErr } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, proveedor, mapeo_columnas, estado')
        .eq('id', id)
        .single();

    if (fetchErr || !importacion) {
        return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 });
    }

    if (importacion.estado === 'completado') {
        return NextResponse.json({ ok: false, error: 'Esta importación ya fue procesada' }, { status: 409 });
    }

    const mapeoActual = importacion.mapeo_columnas as Record<string, any> | null;
    const storagePath = mapeoActual?._storage_path as string | undefined;
    const bucket = (mapeoActual?._bucket as string | undefined) || 'excel-precios';

    if (!storagePath) {
        return NextResponse.json({ ok: false, error: 'No hay archivo asociado' }, { status: 422 });
    }

    // ── Guardar mapeo de columnas ────────────────────────────────────────────
    await supabaseAdmin
        .from('importaciones_excel')
        .update({
            mapeo_columnas: {
                _storage_path: storagePath,
                _bucket: bucket,
                columna_modelo,
                columna_marca,
                columna_precio,
                ...(columna_codigo && { columna_codigo }),
                ...(columna_moneda && { columna_moneda }),
                tipo_costo,
                moneda_default,
            },
            tipo_costo_default: tipo_costo,
            estado: 'procesando',
        })
        .eq('id', id);

    // ── Descargar y parsear Excel ────────────────────────────────────────────
    const { data: fileData, error: downloadErr } = await supabaseAdmin.storage
        .from(bucket)
        .download(storagePath);

    if (downloadErr || !fileData) {
        return NextResponse.json(
            { ok: false, error: `No se pudo leer el archivo: ${downloadErr?.message}` },
            { status: 500 }
        );
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await fileData.arrayBuffer());

    const sheet = workbook.worksheets[0];
    if (!sheet) {
        return NextResponse.json({ ok: false, error: 'El Excel no tiene hojas de cálculo' }, { status: 422 });
    }

    // Leer todas las filas
    type FilaExcel = {
        modelo: string; marca: string; precio: number;
        codigo: string | null; moneda: string;
    };

    const filas: FilaExcel[] = [];
    let headers: string[] = [];

    sheet.eachRow((row, rowIndex) => {
        const vals = (row.values as any[]).slice(1); // exceljs es 1-based
        if (rowIndex === 1) {
            headers = vals.map(cellToString);
            return;
        }

        const byHeader: Record<string, string> = {};
        headers.forEach((h, i) => { byHeader[h] = cellToString(vals[i]); });

        const modelo = byHeader[columna_modelo]?.trim() ?? '';
        const marca = byHeader[columna_marca]?.trim() ?? '';
        const precioStr = byHeader[columna_precio]?.trim() ?? '';
        const codigo = columna_codigo ? (byHeader[columna_codigo]?.trim() || null) : null;
        const moneda = columna_moneda ? (byHeader[columna_moneda]?.trim() || moneda_default) : moneda_default;

        if (!modelo && !marca) return; // fila sin datos de identificación
        const precioNum = parseFloat(precioStr.replace(/[^0-9.]/g, ''));
        if (isNaN(precioNum) || precioNum <= 0) return;

        filas.push({ modelo, marca, precio: precioNum, codigo, moneda });
    });

    if (filas.length === 0) {
        return NextResponse.json({ ok: false, error: 'No se encontraron filas con datos válidos' }, { status: 422 });
    }

    // ── Matching via RPC fn_match_articulo_proveedor (pg_trgm en Postgres) ──
    // Se ejecutan CONCURRENCY llamadas paralelas para procesar todas las filas.

    type MatchResult = {
        articulo_id: string;
        puntaje_match: number;
        metodo_match: string;
    } | null;

    const matchResults = await pMap<FilaExcel, MatchResult>(
        filas,
        async (fila) => {
            const { data, error } = await supabaseAdmin.rpc('fn_match_articulo_proveedor', {
                p_modelo: fila.modelo || null,
                p_marca:  fila.marca  || null,
                p_codigo: fila.codigo || null,
            });

            if (error || !data || data.length === 0) return null;

            const match = data[0] as any;
            return {
                articulo_id:  match.articulo_id,
                puntaje_match: Number(match.puntaje_match),
                metodo_match:  match.metodo_match,
            };
        },
        CONCURRENCY
    );

    // ── Construir registros para costos_articulo ─────────────────────────────
    let filasConMatch = 0;

    const costosAInsertar = filas.map((fila, i) => {
        const match = matchResults[i];
        const puntaje = match?.puntaje_match ?? 0;
        const estadoMatch = puntaje >= SCORE_UMBRAL ? 'sugerido' : 'sin_match';
        if (estadoMatch === 'sugerido') filasConMatch++;

        return {
            importacion_id:       id,
            articulo_id:          null,           // se confirma en revisión humana
            articulo_sugerido_id: match?.articulo_id ?? null,
            modelo_excel:         fila.modelo,
            marca_excel:          fila.marca,
            codigo_excel:         fila.codigo,
            tipo_costo,
            valor:                fila.precio,
            moneda:               fila.moneda,
            fuente:               'excel',
            puntaje_match:        puntaje > 0 ? puntaje : null,
            estado_match:         estadoMatch,
            vigente:              false,           // se activa al confirmar
        };
    });

    // ── Insertar en lotes de 100 ─────────────────────────────────────────────
    const LOTE = 100;
    for (let i = 0; i < costosAInsertar.length; i += LOTE) {
        const { error: insErr } = await supabaseAdmin
            .from('costos_articulo')
            .insert(costosAInsertar.slice(i, i + LOTE));

        if (insErr) {
            return NextResponse.json(
                { ok: false, error: `Error al insertar costos (lote ${i / LOTE + 1}): ${insErr.message}` },
                { status: 500 }
            );
        }
    }

    // ── Actualizar estadísticas ──────────────────────────────────────────────
    await supabaseAdmin
        .from('importaciones_excel')
        .update({
            total_filas:    filas.length,
            filas_con_match: filasConMatch,
            estado:         'en_revision',
        })
        .eq('id', id);

    return NextResponse.json({
        ok: true,
        importacion_id:   id,
        total_filas:      filas.length,
        filas_con_match:  filasConMatch,
        filas_sin_match:  filas.length - filasConMatch,
        costos_insertados: costosAInsertar.length,
    });
}
