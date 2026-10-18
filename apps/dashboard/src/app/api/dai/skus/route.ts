import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/dai/skus?proveedor=DAI Autopartes&busqueda=6985
 * Lista los SKUs de la lista de precios del proveedor (server-side, sin RLS),
 * indicando por cada uno si ya tiene ficha de catálogo generada (ficha_articulo_id).
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

    const filas = (data || []) as any[];

    // Fichas ya generadas: alias proveedor → artículo (modelo_excel = sku_proveedor)
    const skus = filas.map((f) => String(f.sku_proveedor ?? '').trim()).filter(Boolean);
    let fichaPorSku = new Map<string, string>();
    if (skus.length > 0) {
        const { data: aliasRows } = await supabaseAdmin
            .from('proveedor_articulos_alias')
            .select('modelo_excel, articulo_id')
            .eq('proveedor', proveedor)
            .in('modelo_excel', skus)
            .not('articulo_id', 'is', null);
        for (const a of aliasRows || []) {
            const m = String(a.modelo_excel ?? '').trim();
            if (m && a.articulo_id && !fichaPorSku.has(m)) fichaPorSku.set(m, String(a.articulo_id));
        }
    }

    const filasConFicha = filas.map((f) => ({
        ...f,
        ficha_articulo_id: fichaPorSku.get(String(f.sku_proveedor ?? '').trim()) || null,
    }));

    return NextResponse.json({ ok: true, filas: filasConFicha });
}
