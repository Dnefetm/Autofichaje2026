import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  try {
    // 1) Lee estado vigente
    const { data: pub, error: e1 } = await supabaseAdmin
      .from('publicaciones_externas')
      .select('id, sale_price_calculated, pricing_status, base_price, external_item_id, external_variation_id, marketplace_id, category_id')
      .eq('id', id).single();

    if (e1 || !pub) return NextResponse.json({ error: 'Publicación no encontrada' }, { status: 404 });

    // 2) Reglas de seguridad
    const blocking = ['missing_cost', 'invalid_strategy', 'no_rule'];
    if (blocking.includes(pub.pricing_status)) {
      return NextResponse.json({
        error: `No se puede aplicar: estado=${pub.pricing_status}. Resuelve la causa antes de publicar.`
      }, { status: 400 });
    }

    // 3) Permite override del precio confirmado por el usuario (puede ajustarlo manualmente antes de aplicar)
    const newPrice = body.confirmed_price ?? pub.sale_price_calculated;
    if (!newPrice || newPrice <= 0) {
      return NextResponse.json({ error: 'Precio inválido' }, { status: 400 });
    }

    // 4) Validación adicional: no permitir cambios > 50% sin segunda confirmación
    if (pub.base_price && Math.abs(newPrice - pub.base_price) / pub.base_price > 0.5 && !body.force) {
      return NextResponse.json({
        requires_confirmation: true,
        delta_percent: ((newPrice - pub.base_price) / pub.base_price) * 100,
        message: 'Variación mayor al 50%. Reenviar con force=true para confirmar.'
      }, { status: 409 });
    }

    // 5) Snapshot de auditoría (quién, cuándo, por qué) con COLUMNAS CORREGIDAS
    await supabaseAdmin.from('publication_pricing_history').insert({
      publicacion_id: id,
      old_price: pub.base_price,
      new_price: newPrice,
      status: 'valid',
      reason: 'manual_apply',
      details: {
        sale_price_calculated: pub.sale_price_calculated,
        override_user: newPrice !== pub.sale_price_calculated,
        reason_text: body.reason ?? null,
        user_id: body.user_id
      },
      created_at: new Date().toISOString()
    });

    // 6) SINCRONIZAR A MERCADO LIBRE INMEDIATAMENTE
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

    if (hasVariation) {
        await meli.updatePrice(pub.marketplace_id, [
            { itemId: pub.external_item_id, variationId: pub.external_variation_id, price: newPrice }
        ]);
    } else {
        await meli.updatePrice(pub.marketplace_id, [
            { itemId: pub.external_item_id, price: newPrice }
        ]);
    }

    // 7) Actualiza el precio "actual" interno en base de datos
    await supabaseAdmin.from('publicaciones_externas')
      .update({ base_price: newPrice, precio_venta: newPrice, actualizado_el: new Date().toISOString() })
      .eq('id', id);

    return NextResponse.json({
      success: true,
      applied_price: newPrice,
      message: 'Precio aplicado y sincronizado a Mercado Libre.'
    });

  } catch (error: any) {
    const errMsg = error?.response?.data?.message
      || error?.response?.data?.error
      || error?.message
      || 'Error desconocido';
    console.error('[POST /api/catalog/external/[id]/pricing/apply]', errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
