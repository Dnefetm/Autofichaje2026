import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';

// Campos editables permitidos
const ALLOWED_FIELDS = ['price', 'stock', 'status'] as const;
type AllowedField = (typeof ALLOWED_FIELDS)[number];

export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await req.json();
        const { field, value } = body as { field: AllowedField; value: any };

        // Validar campo
        if (!ALLOWED_FIELDS.includes(field)) {
            return NextResponse.json({ error: `Campo no permitido: ${field}` }, { status: 400 });
        }

        // Obtener la publicación con todos los datos necesarios para llamar a MeLi
        const { data: pub, error: pubErr } = await supabaseAdmin
            .from('publicaciones_externas')
            .select('id, marketplace_id, external_item_id, external_variation_id')
            .eq('id', id)
            .single();

        if (pubErr || !pub) {
            return NextResponse.json({ error: 'Publicación no encontrada' }, { status: 404 });
        }

        // Obtener el token de acceso del marketplace
        const { data: tokenData } = await supabaseAdmin
            .from('marketplace_tokens')
            .select('access_token')
            .eq('marketplace_id', pub.marketplace_id)
            .single();

        if (!tokenData?.access_token) {
            return NextResponse.json({ error: 'No hay token de acceso para esta cuenta' }, { status: 401 });
        }

        const meli = new MeliAdapter();
        const hasVariation = pub.external_variation_id && pub.external_variation_id !== '0';

        // ───── EJECUTAR ACCIÓN EN MELI ─────────────────────────────────────
        let dbUpdate: Record<string, any> = {};

        if (field === 'price') {
            const numValue = Number(value);
            if (isNaN(numValue) || numValue <= 0) {
                return NextResponse.json({ error: 'Precio inválido' }, { status: 400 });
            }

            if (hasVariation) {
                await meli.updatePrice(pub.marketplace_id, [
                    { itemId: pub.external_item_id, variationId: pub.external_variation_id, price: numValue }
                ]);
            } else {
                await meli.updatePrice(pub.marketplace_id, [
                    { itemId: pub.external_item_id, price: numValue }
                ]);
            }
            dbUpdate = { precio_venta: numValue };

        } else if (field === 'stock') {
            const numValue = Number(value);
            if (isNaN(numValue) || numValue < 0) {
                return NextResponse.json({ error: 'Stock inválido' }, { status: 400 });
            }

            if (hasVariation) {
                await meli.updateStock(pub.marketplace_id, [
                    { itemId: pub.external_item_id, quantity: numValue, variationId: pub.external_variation_id }
                ]);
            } else {
                await meli.updateStock(pub.marketplace_id, [
                    { itemId: pub.external_item_id, quantity: numValue }
                ]);
            }
            dbUpdate = { stock_publicado: numValue };

        } else if (field === 'status') {
            if (value !== 'active' && value !== 'paused') {
                return NextResponse.json({ error: 'Status debe ser active o paused' }, { status: 400 });
            }

            if (value === 'paused') {
                await meli.pauseListing(pub.marketplace_id, pub.external_item_id);
            } else {
                await meli.activateListing(pub.marketplace_id, pub.external_item_id);
            }
            dbUpdate = { status_externo: value };
        }

        // ───── ACTUALIZAR DB LOCAL ──────────────────────────────────────────
        const { error: updateErr } = await supabaseAdmin
            .from('publicaciones_externas')
            .update({ ...dbUpdate, actualizado_el: new Date().toISOString() })
            .eq('id', id);

        if (updateErr) throw updateErr;

        return NextResponse.json({ ok: true, updated: dbUpdate });

    } catch (error: any) {
        // Extraer mensaje legible del error (MeLi devuelve objetos)
        const errMsg = error?.response?.data?.message
            || error?.response?.data?.error
            || error?.message
            || 'Error desconocido';
        console.error('[PUT /api/catalog/external/[id]/update]', errMsg);
        return NextResponse.json({ error: errMsg }, { status: 500 });
    }
}
