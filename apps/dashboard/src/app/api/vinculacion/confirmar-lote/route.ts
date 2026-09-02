/**
 * POST /api/vinculacion/confirmar-lote
 *
 * Vincula en lote publicaciones → artículo sugerido, con cantidad 1 por defecto,
 * y propaga automáticamente a las publicaciones relacionadas (mismo producto de
 * catálogo / par_item_id). Encola recálculo de precio y sync de stock por cada una.
 *
 * Body: { vinculos: [{ publicacion_id: string, articulo_id: string, cantidad_requerida?: number }] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const vinculos = (body.vinculos || []) as {
    publicacion_id: string;
    articulo_id: string;
    cantidad_requerida?: number;
  }[];

  if (!Array.isArray(vinculos) || vinculos.length === 0) {
    return NextResponse.json({ error: 'vinculos es obligatorio' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const ids = vinculos.map((v) => v.publicacion_id);

  // 1. Upsert de mapeos (cantidad por vínculo, 1 por defecto)
  const { error: mapErr } = await supabaseAdmin
    .from('mapeo_publicacion_articulo')
    .upsert(
      vinculos.map((v) => ({
        publicacion_id: v.publicacion_id,
        articulo_id: v.articulo_id,
        cantidad_requerida: Number.isFinite(v.cantidad_requerida) && v.cantidad_requerida! >= 1 ? v.cantidad_requerida : 1,
      })),
      { onConflict: 'publicacion_id,articulo_id' }
    );
  if (mapErr) {
    return NextResponse.json({ error: mapErr.message }, { status: 500 });
  }

  // 2. Marcar como mapeadas
  await supabaseAdmin
    .from('publicaciones_externas')
    .update({ esta_mapeado: true, actualizado_el: now })
    .in('id', ids);

  // 3. Encolar recálculo de precio + sync de stock
  await supabaseAdmin.from('jobs').insert(
    vinculos.flatMap((v) => [
      { type: 'recalc_pricing_bundle', payload: { publicacion_id: v.publicacion_id }, status: 'pending', scheduled_at: now },
      { type: 'sync_stock_mapped', payload: { publicacion_id: v.publicacion_id }, status: 'pending', scheduled_at: now },
    ])
  );

  // 4. Propagación automática a publicaciones relacionadas
  const artPorPub = new Map(vinculos.map((v) => [v.publicacion_id, v.articulo_id]));
  const cantPorPub = new Map(vinculos.map((v) => [v.publicacion_id, Number.isFinite(v.cantidad_requerida) && v.cantidad_requerida! >= 1 ? v.cantidad_requerida : 1]));
  const yaVinculadas = new Set(ids);
  const propagaciones: { publicacion_id: string; articulo_id: string; cantidad_requerida: number }[] = [];

  const { data: pubs } = await supabaseAdmin
    .from('publicaciones_externas')
    .select('id, id_producto_catalogo, par_item_id')
    .in('id', ids);

  for (const p of pubs || []) {
    const key = p.id_producto_catalogo || p.par_item_id;
    if (!key) continue;
    const art = artPorPub.get(p.id);
    if (!art) continue;
    const cantidad = cantPorPub.get(p.id) ?? 1;

    const { data: hermanas } = await supabaseAdmin
      .from('publicaciones_externas')
      .select('id')
      .or(`id_producto_catalogo.eq.${key},par_item_id.eq.${key}`)
      .eq('external_variation_id', '0')
      .or('esta_mapeado.is.null,esta_mapeado.eq.false')
      .limit(50);

    for (const h of hermanas || []) {
      if (yaVinculadas.has(h.id)) continue;
      yaVinculadas.add(h.id);
      propagaciones.push({ publicacion_id: h.id, articulo_id: art, cantidad_requerida: cantidad });
    }
  }

  let propagados = 0;
  if (propagaciones.length > 0) {
    await supabaseAdmin
      .from('mapeo_publicacion_articulo')
      .upsert(propagaciones.map((x) => ({ ...x })), { onConflict: 'publicacion_id,articulo_id' });
    await supabaseAdmin
      .from('publicaciones_externas')
      .update({ esta_mapeado: true, actualizado_el: now })
      .in('id', propagaciones.map((x) => x.publicacion_id));
    await supabaseAdmin.from('jobs').insert(
      propagaciones.flatMap((x) => [
        { type: 'recalc_pricing_bundle', payload: { publicacion_id: x.publicacion_id }, status: 'pending', scheduled_at: now },
        { type: 'sync_stock_mapped', payload: { publicacion_id: x.publicacion_id }, status: 'pending', scheduled_at: now },
      ])
    );
    propagados = propagaciones.length;
  }

  return NextResponse.json({ ok: true, vinculados: vinculos.length, propagados });
}
