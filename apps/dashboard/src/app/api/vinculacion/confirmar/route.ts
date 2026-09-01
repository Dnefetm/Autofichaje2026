/**
 * POST /api/vinculacion/confirmar
 *
 * Confirma un vínculo publicación ↔ artículo con 1 clic (desde la bandeja de
 * triage). Inserta/actualiza la fila en la tabla puente y encola el recálculo
 * de precio y la sincronización de stock, igual que el modal de mapeo.
 *
 * Body: { publicacion_id: uuid, articulo_id: string, cantidad_requerida?: number }
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Registra el alias SKU→artículo (best-effort) para que futuras sugerencias
 * aprendan del criterio del operador. Nunca bloquea el flujo de vinculación.
 */
async function aprenderAlias(publicacion_id: string, articulo_id: string): Promise<void> {
  try {
    const { data: pub } = await supabaseAdmin
      .from('publicaciones_externas')
      .select('seller_sku, brand, model')
      .eq('id', publicacion_id)
      .single();
    if (!pub) return;

    const codigo = (pub.seller_sku || '').replace(/[^0-9a-z]/gi, '').toLowerCase();
    if (!codigo) return; // solo aprendemos cuando hay un SKU claro

    const proveedor = 'meli_vitrina';
    // Upsert manual: los índices únicos son parciales (no aptos para onConflict de PostgREST)
    const { data: existente } = await supabaseAdmin
      .from('proveedor_articulos_alias')
      .select('id')
      .eq('proveedor', proveedor)
      .eq('codigo_excel', codigo)
      .limit(1);

    const fila = {
      articulo_id,
      marca_excel: pub.brand || null,
      modelo_excel: pub.model || null,
      ultima_vez_visto: new Date().toISOString(),
    };

    if (existente && existente.length) {
      await supabaseAdmin.from('proveedor_articulos_alias').update(fila).eq('id', existente[0].id);
    } else {
      await supabaseAdmin
        .from('proveedor_articulos_alias')
        .insert({ proveedor, codigo_excel: codigo, ...fila });
    }
  } catch {
    /* el aprendizaje nunca debe romper el flujo de vinculación */
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const publicacion_id = body.publicacion_id as string | undefined;
  const articulo_id = body.articulo_id as string | undefined;
  const cantidad = Number(body.cantidad_requerida || 1);

  if (!publicacion_id || !articulo_id) {
    return NextResponse.json(
      { error: 'publicacion_id y articulo_id son obligatorios' },
      { status: 400 },
    );
  }
  if (!Number.isFinite(cantidad) || cantidad < 1) {
    return NextResponse.json({ error: 'cantidad_requerida inválida' }, { status: 400 });
  }

  // 1. Asegurar snapshot de inventario (stock 0) para el artículo
  await supabaseAdmin
    .from('inventory_snapshot')
    .upsert({ sku: articulo_id, physical_stock: 0, updated_at: new Date().toISOString() }, { onConflict: 'sku', ignoreDuplicates: true });

  // 2. Upsert del mapeo (idempotente, no destruye un ensamble multi-artículo)
  const { error: mapErr } = await supabaseAdmin
    .from('mapeo_publicacion_articulo')
    .upsert(
      { publicacion_id, articulo_id, cantidad_requerida: cantidad },
      { onConflict: 'publicacion_id,articulo_id' },
    );
  if (mapErr) {
    return NextResponse.json({ error: mapErr.message }, { status: 500 });
  }

  // 3. Marcar como mapeado y liberar el bloqueo de pricing manual
  await supabaseAdmin
    .from('publicaciones_externas')
    .update({ esta_mapeado: true, actualizado_el: new Date().toISOString() })
    .eq('id', publicacion_id);
  await supabaseAdmin
    .from('publicaciones_externas')
    .update({ sync_disabled: false, sync_disabled_reason: null })
    .eq('id', publicacion_id)
    .eq('sync_disabled_reason', 'pricing_needs_manual_mapping');

  // 4. Encolar recálculo de precio y sync de stock
  const now = new Date().toISOString();
  await supabaseAdmin.from('jobs').insert([
    { type: 'recalc_pricing_bundle', payload: { publicacion_id }, status: 'pending', scheduled_at: now },
    { type: 'sync_stock_mapped', payload: { publicacion_id }, status: 'pending', scheduled_at: now },
  ]);

  // 5. Aprendizaje de alias (best-effort, no bloquea el vínculo)
  await aprenderAlias(publicacion_id, articulo_id);

  return NextResponse.json({ ok: true, publicacion_id, articulo_id, cantidad_requerida: cantidad });
}
