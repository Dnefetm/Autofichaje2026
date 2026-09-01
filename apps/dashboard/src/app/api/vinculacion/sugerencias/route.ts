/**
 * GET /api/vinculacion/sugerencias?publicacion_id=<uuid>
 *
 * Devuelve las sugerencias de vinculación más probables para una publicación,
 * ordenadas por confianza, más el mapeo actual si ya existe.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sugerirArticulos, type PublicacionSugerible } from '@/lib/vinculacion/sugerencias';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const publicacionId = searchParams.get('publicacion_id');

  if (!publicacionId) {
    return NextResponse.json({ error: 'publicacion_id es obligatorio' }, { status: 400 });
  }

  const { data: pub, error } = await supabaseAdmin
    .from('publicaciones_externas')
    .select(
      'id, external_item_id, seller_sku, seller_custom_field, ean, gtin, upc, model, brand, titulo, marketplace_id, id_producto_catalogo, par_item_id, esta_mapeado',
    )
    .eq('id', publicacionId)
    .single();

  if (error || !pub) {
    return NextResponse.json({ error: 'Publicación no encontrada' }, { status: 404 });
  }

  // Mapeo actual (si ya está vinculada)
  const { data: mapeos } = await supabaseAdmin
    .from('mapeo_publicacion_articulo')
    .select('articulo_id, cantidad_requerida, articulos(nombre, marca, modelo, codigo_universal)')
    .eq('publicacion_id', publicacionId);

  const sugerencia: PublicacionSugerible = {
    id: pub.id,
    external_item_id: pub.external_item_id,
    seller_sku: pub.seller_sku,
    seller_custom_field: pub.seller_custom_field,
    ean: pub.ean,
    gtin: pub.gtin,
    upc: pub.upc,
    model: pub.model,
    brand: pub.brand,
    titulo: pub.titulo,
    marketplace_id: pub.marketplace_id,
    id_producto_catalogo: pub.id_producto_catalogo,
    par_item_id: pub.par_item_id,
  };

  const sugerencias = (mapeos && mapeos.length > 0)
    ? []
    : await sugerirArticulos(sugerencia);

  return NextResponse.json({
    ok: true,
    ya_mapeado: !!pub.esta_mapeado && (mapeos?.length ?? 0) > 0,
    mapeo_actual: (mapeos || []).map((m: any) => ({
      articulo_id: m.articulo_id,
      cantidad_requerida: m.cantidad_requerida,
      nombre: m.articulos?.nombre ?? null,
      marca: m.articulos?.marca ?? null,
      modelo: m.articulos?.modelo ?? null,
    })),
    sugerencias: sugerencias.slice(0, 5),
  });
}
