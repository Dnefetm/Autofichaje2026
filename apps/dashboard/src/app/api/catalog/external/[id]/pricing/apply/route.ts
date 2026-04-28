import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  // body: { confirmed_price?: number; reason?: string; user_id: string, force?: boolean }

  // 1) Lee estado vigente
  const { data: pub, error: e1 } = await supabaseAdmin
    .from('publicaciones_externas')
    .select('id, sale_price_calculated, pricing_status, base_price, external_item_id, marketplace_id, category_id')
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

  // 5) Snapshot de auditoría (quién, cuándo, por qué)
  await supabaseAdmin.from('publication_pricing_history').insert({
    publicacion_id: id,
    precio_anterior: pub.base_price,
    precio_nuevo: newPrice,
    razon: 'manual_apply',
    detalle: {
      sale_price_calculated: pub.sale_price_calculated,
      override_user: newPrice !== pub.sale_price_calculated,
      reason_text: body.reason ?? null,
      user_id: body.user_id
    },
    created_at: new Date().toISOString()
  });

  // 6) Actualiza el precio "actual" interno
  await supabaseAdmin.from('publicaciones_externas')
    .update({ base_price: newPrice, actualizado_el: new Date().toISOString() })
    .eq('id', id);

  // 7) Encola job para empujar a la API de Meli (reutiliza fn_encolar_sync_price_marketplace pattern)
  await supabaseAdmin.from('jobs').insert({
    type: 'sync_price_to_marketplace',
    payload: {
      publicacion_id: id,
      external_item_id: pub.external_item_id,
      marketplace_id: pub.marketplace_id,
      sale_price: newPrice
    },
    status: 'pending',
    scheduled_at: new Date().toISOString()
  });

  return NextResponse.json({
    success: true,
    applied_price: newPrice,
    message: 'Precio aplicado. Sincronización a Meli encolada.'
  });
}
