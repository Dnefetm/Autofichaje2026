/**
 * PATCH /api/precios/importar/[id]/mapear
 *
 * 1. Guarda el mapeo de columnas elegido por el usuario en importaciones_excel.
 * 2. Lee el Excel completo desde Storage.
 * 3. Para cada fila, busca el artículo en `articulos` usando el campo mapeado.
 * 4. Inserta registros en `costos_articulo` con estado_match:
 *    - 'sugerido'   si encontró un candidato (puntaje ≥ umbral)
 *    - 'sin_match'  si no encontró ninguno
 * 5. Actualiza el estado de la importación a 'en_revision'.
 * 6. Guarda el tipo_costo_default para futuras importaciones del mismo proveedor.
 *
 * Body:
 * {
 *   columna_modelo: string,       // nombre de la columna del Excel que es el identificador
 *   columna_precio: string,       // nombre de la columna de precio
 *   columna_moneda?: string,      // nombre de la columna de moneda (opcional)
 *   tipo_costo: string,           // distribuidor | subdistribuidor | lista | mayoreo | otro
 *   moneda_default?: string,      // MXN | USD (default MXN si no hay columna_moneda)
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import ExcelJS from 'exceljs';

export const dynamic = 'force-dynamic';

// Umbral mínimo de score para considerar un match como "sugerido"
const SCORE_UMBRAL = 50;

/** Normaliza texto para comparación fuzzy: minúsculas, sin acentos, sin espacios extra */
function normalizar(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Score de similitud simple: porcentaje de tokens del query que aparecen en el target.
 * 0-100 donde 100 = match perfecto.
 */
function calcularScore(query: string, target: string): number {
    const qNorm = normalizar(query);
    const tNorm = normalizar(target);
    if (qNorm === tNorm) return 100;
    if (tNorm.includes(qNorm) || qNorm.includes(tNorm)) return 90;

    const qTokens = qNorm.split(' ').filter(Boolean);
    const tTokens = new Set(tNorm.split(' ').filter(Boolean));
    const matches = qTokens.filter((t) => tTokens.has(t)).length;
    return Math.round((matches / Math.max(qTokens.length, 1)) * 80);
}

export async function PATCH(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const { id } = await props.params;

    const body = await req.json().catch(() => null);
    if (!body?.columna_modelo || !body?.columna_precio || !body?.tipo_costo) {
        return NextResponse.json(
            { ok: false, error: 'Se requieren: columna_modelo, columna_precio, tipo_costo' },
            { status: 400 }
        );
    }

    const { columna_modelo, columna_precio, columna_moneda, tipo_costo, moneda_default = 'MXN' } = body;

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
        return NextResponse.json(
            { ok: false, error: 'Esta importación ya fue procesada' },
            { status: 409 }
        );
    }

    const mapeoActual = importacion.mapeo_columnas as Record<string, any> | null;
    const storagePath = mapeoActual?._storage_path as string | undefined;
    const bucket = (mapeoActual?._bucket as string | undefined) || 'excel-precios';

    if (!storagePath) {
        return NextResponse.json(
            { ok: false, error: 'No hay archivo asociado a esta importación' },
            { status: 422 }
        );
    }

    // ── Guardar el mapeo ─────────────────────────────────────────────────────
    const nuevoMapeo = {
        _storage_path: storagePath,
        _bucket: bucket,
        columna_modelo,
        columna_precio,
        ...(columna_moneda && { columna_moneda }),
        tipo_costo,
        moneda_default,
    };

    const { error: updateMapeoErr } = await supabaseAdmin
        .from('importaciones_excel')
        .update({
            mapeo_columnas: nuevoMapeo,
            tipo_costo_default: tipo_costo,
            estado: 'procesando',
        })
        .eq('id', id);

    if (updateMapeoErr) {
        return NextResponse.json(
            { ok: false, error: `No se pudo guardar el mapeo: ${updateMapeoErr.message}` },
            { status: 500 }
        );
    }

    // ── Descargar y parsear el Excel ─────────────────────────────────────────
    const { data: fileData, error: downloadErr } = await supabaseAdmin.storage
        .from(bucket)
        .download(storagePath);

    if (downloadErr || !fileData) {
        return NextResponse.json(
            { ok: false, error: `No se pudo leer el archivo: ${downloadErr?.message}` },
            { status: 500 }
        );
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);

    const sheet = workbook.worksheets[0];
    if (!sheet) {
        return NextResponse.json({ ok: false, error: 'Hoja de cálculo no encontrada' }, { status: 422 });
    }

    // Leer todas las filas
    const allRows: Record<string, string>[] = [];
    let headers: string[] = [];

    sheet.eachRow((row, rowIndex) => {
        const values = (row.values as any[]).slice(1);
        if (rowIndex === 1) {
            headers = values.map((v) => String(v ?? ''));
            return;
        }
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
            let v = values[i];
            if (v === null || v === undefined) v = '';
            else if (typeof v === 'object' && 'result' in v) v = String(v.result);
            else if (typeof v === 'object' && 'text' in v) v = String(v.text);
            else v = String(v);
            obj[h] = v;
        });
        allRows.push(obj);
    });

    if (!headers.includes(columna_modelo) || !headers.includes(columna_precio)) {
        return NextResponse.json(
            { ok: false, error: `Las columnas "${columna_modelo}" o "${columna_precio}" no existen en el archivo. Columnas disponibles: ${headers.join(', ')}` },
            { status: 422 }
        );
    }

    // ── Cargar artículos desde DB para matching ──────────────────────────────
    const { data: articulos, error: artErr } = await supabaseAdmin
        .from('articulos')
        .select('articulo_id, nombre, marca, modelo')
        .eq('activo', true)
        .limit(5000);

    if (artErr) {
        return NextResponse.json(
            { ok: false, error: `Error al cargar artículos: ${artErr.message}` },
            { status: 500 }
        );
    }

    // ── Matching por fila ────────────────────────────────────────────────────
    let totalFilas = 0;
    let filasConMatch = 0;
    const costosAInsertar: any[] = [];

    for (const row of allRows) {
        const valorModelo = row[columna_modelo]?.trim();
        const valorPrecio = row[columna_precio]?.trim();
        const valorMoneda = columna_moneda ? row[columna_moneda]?.trim() : null;

        // Saltar filas sin datos clave
        if (!valorModelo || !valorPrecio) continue;

        const precioNum = parseFloat(valorPrecio.replace(/[^0-9.]/g, ''));
        if (isNaN(precioNum) || precioNum <= 0) continue;

        totalFilas++;

        // Buscar mejor match por modelo/nombre
        let mejorScore = 0;
        let mejorArticulo: (typeof articulos)[0] | null = null;

        for (const art of articulos ?? []) {
            const candidatos = [art.modelo, art.nombre, `${art.marca} ${art.modelo}`].filter(Boolean);
            for (const candidato of candidatos) {
                const score = calcularScore(valorModelo, candidato);
                if (score > mejorScore) {
                    mejorScore = score;
                    mejorArticulo = art;
                }
            }
        }

        const estadoMatch = mejorScore >= SCORE_UMBRAL ? 'sugerido' : 'sin_match';
        if (estadoMatch === 'sugerido') filasConMatch++;

        costosAInsertar.push({
            importacion_id: id,
            articulo_id: null,  // se confirma en paso siguiente (validación humana)
            modelo_excel: valorModelo,  // valor crudo del Excel para trazabilidad
            articulo_sugerido_id: mejorScore >= SCORE_UMBRAL ? mejorArticulo?.articulo_id : null,
            tipo_costo,
            valor: precioNum,
            moneda: valorMoneda || moneda_default,
            fuente: 'excel',
            puntaje_match: mejorScore > 0 ? mejorScore : null,
            estado_match: estadoMatch,
            vigente: false,  // se vuelve true al confirmar
        });
    }

    // ── Insertar costos en lotes ─────────────────────────────────────────────
    const BATCH = 100;
    let insertadas = 0;

    for (let i = 0; i < costosAInsertar.length; i += BATCH) {
        const lote = costosAInsertar.slice(i, i + BATCH);
        const { error: insErr } = await supabaseAdmin
            .from('costos_articulo')
            .insert(lote);

        if (insErr) {
            return NextResponse.json(
                { ok: false, error: `Error al insertar costos (lote ${i}): ${insErr.message}` },
                { status: 500 }
            );
        }
        insertadas += lote.length;
    }

    // ── Actualizar estadísticas de la importación ────────────────────────────
    await supabaseAdmin
        .from('importaciones_excel')
        .update({
            total_filas: totalFilas,
            filas_con_match: filasConMatch,
            estado: 'en_revision',
        })
        .eq('id', id);

    return NextResponse.json({
        ok: true,
        importacion_id: id,
        total_filas: totalFilas,
        filas_con_match: filasConMatch,
        filas_sin_match: totalFilas - filasConMatch,
        costos_insertados: insertadas,
    });
}
