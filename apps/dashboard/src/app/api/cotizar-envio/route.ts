/**
 * POST /api/cotizar-envio
 *
 * Cotiza el costo de envío (list_cost) ANTES de publicar, sin item_id.
 * Usa GET /users/{seller}/shipping_options/free con dimensions + contexto,
 * tal como documenta MeLi en "Mercado Envíos - Costos y cotizaciones"
 * (peso en gramos enteros; requiere item_price + listing_type_id + mode + free_shipping).
 *
 * Body esperado:
 * {
 *   marketplace_id: string,
 *   largo_cm: number, ancho_cm: number, alto_cm: number, peso_gramos: number,
 *   item_price: number,
 *   listing_type_id: string,   // "gold_special" | "gold_pro" | "silver" | "free"
 *   mode: string,              // "me2" | "custom"
 *   free_shipping: boolean
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { MeliAdapter } from '@gestor/adapters/meli';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const marketplace_id = body?.marketplace_id;
        const nums = ['largo_cm', 'ancho_cm', 'alto_cm', 'peso_gramos', 'item_price'];
        for (const k of nums) {
            if (body?.[k] == null || Number.isNaN(Number(body[k]))) {
                return NextResponse.json({ ok: false, error: `Falta o es inválido: ${k}` }, { status: 400 });
            }
        }
        if (!marketplace_id) {
            return NextResponse.json({ ok: false, error: 'Falta marketplace_id' }, { status: 400 });
        }

        const meli = new MeliAdapter();
        const res = await meli.cotizarEnvioCosto(marketplace_id, {
            largo_cm: Number(body.largo_cm),
            ancho_cm: Number(body.ancho_cm),
            alto_cm: Number(body.alto_cm),
            peso_gramos: Math.round(Number(body.peso_gramos)),
            item_price: Number(body.item_price),
            listing_type_id: body.listing_type_id || 'gold_special',
            mode: body.mode || 'me2',
            free_shipping: !!body.free_shipping,
        });

        return NextResponse.json({
            ok: res.list_cost != null,
            list_cost: res.list_cost,
            status: res.status,
            raw: res.raw,
        });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || 'Error cotizando envío' }, { status: 500 });
    }
}
