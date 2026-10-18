import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET/PUT /api/precios/proveedor/[proveedor]/stock-politica
 * Lee o guarda la política de stock del proveedor (modo fijo/proveedor/fisico/manual).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ proveedor: string }> }) {
    const proveedor = decodeURIComponent((await params).proveedor);
    const { data, error } = await supabaseAdmin
        .from('politica_stock')
        .select('*')
        .eq('proveedor', proveedor)
        .limit(1)
        .maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, politica: data || null });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ proveedor: string }> }) {
    const proveedor = decodeURIComponent((await params).proveedor);
    const body = await req.json().catch(() => null);
    const modo = String(body?.modo ?? '');
    if (!['fijo', 'proveedor', 'fisico', 'manual'].includes(modo)) {
        return NextResponse.json({ ok: false, error: 'modo inválido' }, { status: 400 });
    }

    const stockFijo = Number(body?.stock_fijo);
    const fraccion = Number(body?.fraccion_maxima);

    const payload: Record<string, any> = {
        proveedor,
        modo,
        stock_fijo: modo === 'fijo' ? (Number.isFinite(stockFijo) && stockFijo >= 0 ? Math.round(stockFijo) : null) : null,
        fraccion_maxima: modo === 'proveedor' ? (Number.isFinite(fraccion) && fraccion > 0 && fraccion <= 1 ? fraccion : 0.2) : null,
        activo: body?.activo !== false,
        actualizado_el: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
        .from('politica_stock')
        .upsert(payload, { onConflict: 'proveedor' });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, politica: data?.[0] ?? payload });
}
