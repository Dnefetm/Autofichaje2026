/**
 * GET /api/articulos/buscar?query=...&limit=20
 *
 * Busca articulos en el catalogo maestro por texto libre.
 * Usado por el modal de Remap en el wizard de precios.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('query') ?? '';
    const limitParam = searchParams.get('limit');
    const limit = Math.min(Math.max(Number(limitParam) || 20, 1), 50);

    if (!query || query.trim().length < 2) {
        return NextResponse.json(
            { error: 'Parametro query es obligatorio (minimo 2 caracteres)' },
            { status: 400 }
        );
    }

    const ilikePattern = `%${query}%`;

    const { data, error } = await supabaseAdmin
        .from('articulos')
        .select('articulo_id, modelo, marca, codigo_universal, descripcion, nombre, caja_madre')
        .or(
            [
                `modelo.ilike.${ilikePattern}`,
                `marca.ilike.${ilikePattern}`,
                `codigo_universal.ilike.${ilikePattern}`,
                `descripcion.ilike.${ilikePattern}`,
                `nombre.ilike.${ilikePattern}`,
            ].join(',')
        )
        .limit(limit);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
        items: (data ?? []).map((row) => ({
            articulo_id: row.articulo_id,
            modelo: row.modelo,
            marca: row.marca,
            codigo_universal: row.codigo_universal,
            descripcion: row.descripcion,
            nombre: row.nombre,
            caja_madre: row.caja_madre,
        })),
    });
}
