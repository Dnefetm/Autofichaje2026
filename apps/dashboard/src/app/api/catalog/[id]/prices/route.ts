/**
 * GET  /api/catalog/[id]/prices — Devuelve todos los precios por cuenta para el artículo
 * PATCH /api/catalog/[id]/prices — Upsert de precio para una cuenta específica
 *
 * Body del PATCH:
 * {
 *   marketplace_id: string,   // UUID de la cuenta en marketplace_configs
 *   sale_price: number,       // Precio de venta (obligatorio)
 *   base_price?: number,      // Precio de lista/referencia (opcional)
 *   sku_tienda?: string       // SKU para esa tienda (default: articulo.modelo)
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(
    _req: NextRequest,
    { params }: { params: { id: string } }
) {
    const articulo_id = params.id;

    // Precios del artículo en todas las cuentas
    const { data: prices, error } = await supabaseAdmin
        .from('marketplace_prices')
        .select(`
            id, articulo_id, marketplace_id, sku_tienda,
            base_price, sale_price, currency, updated_at,
            marketplace_configs (id, account_name, is_active)
        `)
        .eq('articulo_id', articulo_id)
        .order('updated_at', { ascending: false });

    if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    // Cuentas activas que NO tienen precio configurado todavía
    const configuredIds = new Set((prices || []).map((p: any) => p.marketplace_id));
    const { data: allAccounts } = await supabaseAdmin
        .from('marketplace_configs')
        .select('id, account_name')
        .eq('is_active', true);

    const unconfigured = (allAccounts || []).filter((a: any) => !configuredIds.has(a.id));

    return NextResponse.json({ ok: true, prices: prices || [], unconfigured });
}

// ── PATCH ────────────────────────────────────────────────────────────────────
export async function PATCH(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    const articulo_id = params.id;

    const body = await req.json().catch(() => null);
    if (!body || !body.marketplace_id || body.sale_price == null) {
        return NextResponse.json(
            { ok: false, error: 'Se requieren marketplace_id y sale_price' },
            { status: 400 }
        );
    }

    const { marketplace_id, sale_price, base_price, sku_tienda } = body;

    if (typeof sale_price !== 'number' || sale_price <= 0) {
        return NextResponse.json(
            { ok: false, error: 'sale_price debe ser un número positivo' },
            { status: 400 }
        );
    }

    // Verificar que el artículo existe
    const { data: articulo, error: artErr } = await supabaseAdmin
        .from('articulos')
        .select('articulo_id, modelo')
        .eq('articulo_id', articulo_id)
        .single();

    if (artErr || !articulo) {
        return NextResponse.json({ ok: false, error: 'Artículo no encontrado' }, { status: 404 });
    }

    // Upsert — si sku_tienda no se envía, usar el modelo del artículo como default
    const { data: upserted, error: upsertErr } = await supabaseAdmin
        .from('marketplace_prices')
        .upsert({
            articulo_id,
            marketplace_id,
            sale_price,
            ...(base_price != null && { base_price }),
            sku_tienda: sku_tienda || articulo.modelo || null,
            updated_at: new Date().toISOString(),
        }, {
            onConflict: 'articulo_id,marketplace_id',
        })
        .select()
        .single();

    if (upsertErr) {
        return NextResponse.json({ ok: false, error: upsertErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, price: upserted });
}
