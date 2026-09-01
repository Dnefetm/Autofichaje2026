/**
 * POST /api/fichas/generar-desde-meli
 *
 * Reverse-fill: crea una ficha técnica borrador pre-llenada con los datos que
 * ya existen en la publicación de MeLi (título, descripción, marca, modelo,
 * EAN/GTIN) y la asocia al artículo mapeado. El operador solo revisa y completa.
 *
 * Body: { publicacion_id: uuid }
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const publicacion_id = body.publicacion_id as string | undefined;

  if (!publicacion_id) {
    return NextResponse.json({ error: 'publicacion_id es obligatorio' }, { status: 400 });
  }

  const { data: pub, error: pubErr } = await supabaseAdmin
    .from('publicaciones_externas')
    .select(
      'id, external_item_id, titulo, description_plain, brand, model, ean, gtin, upc, id_producto_catalogo',
    )
    .eq('id', publicacion_id)
    .single();

  if (pubErr || !pub) {
    return NextResponse.json({ error: 'Publicación no encontrada' }, { status: 404 });
  }

  // Artículo mapeado (si existe), para asociar la ficha
  const { data: mapeo } = await supabaseAdmin
    .from('mapeo_publicacion_articulo')
    .select('articulo_id')
    .eq('publicacion_id', publicacion_id)
    .limit(1);

  const articulo_id = (mapeo && mapeo[0]?.articulo_id) || null;

  const descripcion = pub.description_plain
    ? pub.description_plain
    : [pub.brand, pub.model].filter(Boolean).join(' ');

  const { data: ficha, error: insErr } = await supabaseAdmin
    .from('fichas_tecnicas')
    .insert({
      estado: 'borrador',
      nombre_producto: pub.titulo,
      descripcion: descripcion || null,
      articulo_id,
      publicacion_externa_id: pub.id,
      ml_item_id: pub.external_item_id,
    })
    .select('id')
    .single();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    id: ficha.id,
    articulo_id,
    publicacion_id: pub.id,
  });
}
