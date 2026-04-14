/**
 * PATCH /api/precios/importar/[id]/mapear
 *
 * 1. Guarda el mapeo de columnas en importaciones_excel.
 * 2. Lee el Excel completo desde Storage.
 * 3. Por cada fila del Excel × cada tipo de precio mapeado →
 *    llama a fn_match_articulo_proveedor (pg_trgm) e inserta en costos_articulo.
 *    Esto permite que un Excel con 4 columnas de precio genere 4 registros por fila.
 * 4. Actualiza estado → 'en_revision'.
 *
 * Body:
 * {
 *   columna_modelo:  string,          // obligatoria — identificador de producto
 *   columna_marca:   string,          // obligatoria — marca del proveedor
 *   precios: Array<{                  // obligatoria — uno o más tipos de precio
 *     columna:    string,             //   columna del Excel que tiene el precio
 *     tipo_costo: string,             //   distribuidor|subdistribuidor|lista|mayoreo|otro
 *   }>,
 *   columna_codigo?: string,          // opcional — UPC/EAN → match exacto score 100
 *   columna_moneda?: string,          // opcional
 *   moneda_default?: string,          // default 'MXN'
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import ExcelJS from 'exceljs';

export const dynamic = 'force-dynamic';

const CONCURRENCY  = 20;   // llamadas RPC paralelas
const SCORE_UMBRAL = 40;   // umbral mínimo para estado 'sugerido'

interface PrecioMapeo {
    columna:    string;
    tipo_costo: string;
}

function cellToString(v: any): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object' && 'result' in v) return String(v.result ?? '');
    if (typeof v === 'object' && 'text'   in v) return String(v.text   ?? '');
    return String(v);
}

async function pMap<T, R>(items: T[], fn: (item: T, i: number) => Promise<R>, concurrency: number): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let idx = 0;
    async function worker() {
        while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    return results;
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const { id } = await props.params;

    const body = await req.json().catch(() => null);
    const { columna_modelo, columna_marca, precios, columna_codigo,
            columna_moneda, moneda_default = 'MXN' } = body ?? {};

    // ── Validaciones ─────────────────────────────────────────────────────────
    if (!columna_modelo) {
        return NextResponse.json({ ok: false, error: 'Se requiere columna_modelo' }, { status: 400 });
    }
    if (!columna_marca) {
        return NextResponse.json({ ok: false, error: 'Se requiere columna_marca' }, { status: 400 });
    }
    if (!Array.isArray(precios) || precios.length === 0) {
        return NextResponse.json(
            { ok: false, error: 'Se requiere "precios" como array con al menos un {columna, tipo_costo}' },
            { status: 400 }
        );
    }
    const preciosInvalidos = precios.filter((p: any) => !p?.columna || !p?.tipo_costo);
    if (preciosInvalidos.length > 0) {
        return NextResponse.json({ ok: false, error: 'Cada elemento de "precios" debe tener columna y tipo_costo' }, { status: 400 });
    }

    // ── Traer la importación ──────────────────────────────────────────────────
    const { data: importacion, error: fetchErr } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, proveedor, mapeo_columnas, estado')
        .eq('id', id)
        .single();

    if (fetchErr || !importacion) {
        return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 });
    }
    if (importacion.estado === 'completado') {
        return NextResponse.json({ ok: false, error: 'Importación ya procesada' }, { status: 409 });
    }

    const mapeoActual  = importacion.mapeo_columnas as Record<string, any> | null;
    const storagePath  = mapeoActual?._storage_path as string | undefined;
    const bucket       = (mapeoActual?._bucket as string | undefined) || 'excel-precios';

    if (!storagePath) {
        return NextResponse.json({ ok: false, error: 'No hay archivo asociado' }, { status: 422 });
    }

    // ── Guardar mapeo ─────────────────────────────────────────────────────────
    // tipo_costo_default: memoriza todos los tipos de costo usados (separados por coma)
    const tiposCosto = [...new Set((precios as PrecioMapeo[]).map((p) => p.tipo_costo))].join(',');

    await supabaseAdmin
        .from('importaciones_excel')
        .update({
            mapeo_columnas: {
                _storage_path: storagePath,
                _bucket:       bucket,
                columna_modelo,
                columna_marca,
                precios,                              // array completo para reutilizar
                ...(columna_codigo && { columna_codigo }),
                ...(columna_moneda && { columna_moneda }),
                moneda_default,
            },
            tipo_costo_default: tiposCosto,
            estado: 'procesando',
        })
        .eq('id', id);

    // ── Descargar y parsear Excel ─────────────────────────────────────────────
    const { data: fileData, error: downloadErr } = await supabaseAdmin.storage
        .from(bucket).download(storagePath);

    if (downloadErr || !fileData) {
        return NextResponse.json({ ok: false, error: `No se pudo leer el archivo: ${downloadErr?.message}` }, { status: 500 });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await fileData.arrayBuffer());
    const sheet = workbook.worksheets[0];
    if (!sheet) {
        return NextResponse.json({ ok: false, error: 'El Excel no tiene hojas' }, { status: 422 });
    }

    // Leer filas
    type FilaExcel = { modelo: string; marca: string; codigo: string | null; moneda: string; preciosPorColumna: Record<string, number> };
    const filas: FilaExcel[] = [];
    let headers: string[] = [];

    sheet.eachRow((row, rowIndex) => {
        const vals = (row.values as any[]).slice(1);
        if (rowIndex === 1) { headers = vals.map(cellToString); return; }

        const byHeader: Record<string, string> = {};
        headers.forEach((h, i) => { byHeader[h] = cellToString(vals[i]); });

        const modelo = byHeader[columna_modelo]?.trim() ?? '';
        const marca  = byHeader[columna_marca]?.trim()  ?? '';
        if (!modelo && !marca) return;

        const codigo = columna_codigo ? (byHeader[columna_codigo]?.trim() || null) : null;
        const moneda = columna_moneda ? (byHeader[columna_moneda]?.trim() || moneda_default) : moneda_default;

        // Recoger TODOS los precios mapeados para esta fila
        const preciosPorColumna: Record<string, number> = {};
        for (const p of precios as PrecioMapeo[]) {
            const raw = byHeader[p.columna]?.trim() ?? '';
            const num = parseFloat(raw.replace(/[^0-9.]/g, ''));
            if (!isNaN(num) && num > 0) preciosPorColumna[p.columna] = num;
        }

        // Solo procesar si tiene al menos un precio válido
        if (Object.keys(preciosPorColumna).length === 0) return;

        filas.push({ modelo, marca, codigo, moneda, preciosPorColumna });
    });

    if (filas.length === 0) {
        return NextResponse.json({ ok: false, error: 'No se encontraron filas con datos válidos' }, { status: 422 });
    }

    // ── Matching via RPC fn_match_articulo_proveedor ──────────────────────────
    // Una sola llamada por fila (el match es igual para todos sus tipos de precio)
    type MatchResult = { articulo_id: string; puntaje_match: number; metodo_match: string } | null;

    const matchResults = await pMap<FilaExcel, MatchResult>(
        filas,
        async (fila) => {
            const { data, error } = await supabaseAdmin.rpc('fn_match_articulo_proveedor', {
                p_modelo: fila.modelo || null,
                p_marca:  fila.marca  || null,
                p_codigo: fila.codigo || null,
            });
            if (error || !data || data.length === 0) return null;
            const m = data[0] as any;
            return { articulo_id: m.articulo_id, puntaje_match: Number(m.puntaje_match), metodo_match: m.metodo_match };
        },
        CONCURRENCY
    );

    // ── Construir registros (fila × tipo de precio) ───────────────────────────
    let filasConMatch   = 0;
    let filasSinPrecio  = 0;
    const costosAInsertar: any[] = [];
    const filasContadas = new Set<number>(); // para no contar duplicados en con_match

    filas.forEach((fila, i) => {
        const match   = matchResults[i];
        const puntaje = match?.puntaje_match ?? 0;
        const estadoMatch = puntaje >= SCORE_UMBRAL ? 'sugerido' : 'sin_match';

        (precios as PrecioMapeo[]).forEach((p) => {
            const valor = fila.preciosPorColumna[p.columna];
            if (!valor) { filasSinPrecio++; return; }

            if (estadoMatch === 'sugerido' && !filasContadas.has(i)) {
                filasConMatch++;
                filasContadas.add(i);
            }

            costosAInsertar.push({
                importacion_id:         id,
                articulo_id:            null,
                articulo_sugerido_id:   match?.articulo_id ?? null,
                modelo_excel:           fila.modelo,
                marca_excel:            fila.marca,
                codigo_universal_excel: fila.codigo,   // campo correcto del schema
                tipo_costo:             p.tipo_costo,
                valor,
                moneda:                 fila.moneda,
                fuente:                 'excel',
                puntaje_match:          puntaje > 0 ? puntaje : null,
                estado_match:           estadoMatch,
                vigente:                false,
            });
        });
    });

    // ── Insertar en lotes ─────────────────────────────────────────────────────
    const LOTE = 100;
    for (let i = 0; i < costosAInsertar.length; i += LOTE) {
        const { error: insErr } = await supabaseAdmin
            .from('costos_articulo')
            .insert(costosAInsertar.slice(i, i + LOTE));
        if (insErr) {
            return NextResponse.json(
                { ok: false, error: `Error al insertar lote ${Math.floor(i / LOTE) + 1}: ${insErr.message}` },
                { status: 500 }
            );
        }
    }

    // ── Actualizar estadísticas ───────────────────────────────────────────────
    await supabaseAdmin
        .from('importaciones_excel')
        .update({
            total_filas:    filas.length,
            filas_con_match: filasConMatch,
            estado:         'en_revision',
        })
        .eq('id', id);

    return NextResponse.json({
        ok:               true,
        importacion_id:   id,
        tipos_precio:     (precios as PrecioMapeo[]).length,
        total_filas:      filas.length,
        filas_con_match:  filasConMatch,
        filas_sin_match:  filas.length - filasConMatch,
        costos_insertados: costosAInsertar.length,  // filas × tipos de precio
    });
}
