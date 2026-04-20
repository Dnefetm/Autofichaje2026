/**
 * POST /api/precios/importar/[id]/confirmar
 *
 * Arquitectura v2: Confirma el lote a través de una transacción atómica PL/pgSQL.
 * Transfiere la persistencia al motor de Postgres, validando precios y purgas en un solo paso.
 * 
 * Body:
 * {
 *   acciones: Array<{
 *     articulo_id: string,
 *     accion: 'actualizar' | 'aceptar_cambio_codigo' | 'crear_nuevo' | 'rechazar',
 *     precios: { distribuidor?: number, lista?: number, mayoreo?: number... }
 *   }>
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface DecisionLinea {
    articulo_id: string;
    accion: 'actualizar' | 'aceptar_cambio_codigo' | 'crear_nuevo' | 'rechazar';
    precios: Record<string, number>;
}

export async function POST(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const { id } = await props.params;
    const body = await req.json().catch(() => null);
    const acciones: DecisionLinea[] = body?.acciones;

    if (!Array.isArray(acciones)) {
        return NextResponse.json(
            { ok: false, error: 'Se requiere un array de "acciones" estructurado.' },
            { status: 400 }
        );
    }

    const { data: importacion, error: fetchErr } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, proveedor')
        .eq('id', id)
        .single();

    if (fetchErr || !importacion) {
        return NextResponse.json({ ok: false, error: 'Importacion no encontrada' }, { status: 404 });
    }

    // ── Ejecución Transaccional v2 ──────────────────────────────────────────────
    // Llama a la función PL/pgSQL que asegura el UPSERT atómico y el flaggeado
    // de los productos descontinuados (ausentes en este lote).
    const { data: resultados, error: txError } = await supabaseAdmin.rpc('confirmar_importacion_tx', {
        p_importacion_id: id,
        p_decisiones: acciones,
        p_proveedor: importacion.proveedor
    });

    if (txError) {
        console.error(JSON.stringify({ event: 'tx_confirmar_error', importacion_id: id, error: txError }));
        return NextResponse.json(
            { ok: false, error: `Transacción falló: ${txError.message}` },
            { status: 500 }
        );
    }

    return NextResponse.json({
        ok: true,
        importacion_id: id,
        ...resultados
    });
}