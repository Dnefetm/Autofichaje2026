import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/dai/skus?proveedor=DAI Autopartes&busqueda=6985
 * Lista los SKUs de la lista de precios del proveedor (server-side, sin RLS).
 */
export async function GET(req: NextRequest) {
    const proveedor = req.nextUrl.searchParams.get('proveedor') || 'DAI Autopartes';
    const busqueda = (req.nextUrl.searchParams.get('busqueda') || '').trim();

    let q = supabaseAdmin
        .from('precios_proveedor')
        .select('sku_proveedor, descripcion, valor, codigo_barra')
        .eq('proveedor', proveedor)
        .eq('vigente', true)
        .order('sku_proveedor', { ascending: true })
        .limit(200);

    if (busqueda) {
        q = q.or(`sku_proveedor.ilike.%${busqueda}%,descripcion.ilike.%${busqueda}%`);
    }

    const { data, error } = await q;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, filas: data || [] });
}
