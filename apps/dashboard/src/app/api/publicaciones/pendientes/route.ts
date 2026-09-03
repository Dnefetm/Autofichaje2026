import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sugerirExactoEnLote, type PublicacionSugerible } from '@/lib/vinculacion/sugerencias';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = (searchParams.get('q') || '').trim();
    const orderBy = (searchParams.get('orderBy') || 'visits_30d') as
      | 'visits_30d'
      | 'precio_venta'
      | 'actualizado_el';
    const page = Math.max(0, parseInt(searchParams.get('page') || '0', 10));
    const pageSize = Math.min(
      200,
      Math.max(10, parseInt(searchParams.get('pageSize') || '50', 10))
    );

    // 1) Consulta inicial de publicaciones sin mapear
    let q = supabase
      .from('publicaciones_externas')
      .select(
        `id, external_item_id, titulo, brand, model, precio_venta, visits_30d,
         url_imagen, marketplace_id, marketplace_configs(account_name), ean, gtin, upc, seller_sku, seller_custom_field,
         domain_id, condition, tipo_publicacion, variation_attributes, par_item_id, id_producto_catalogo,
         es_bundle, tags,
         sync_disabled, sync_disabled_reason, pricing_status, sale_price_calculated,
         actualizado_el`,
        { count: 'exact' }
      )
      .or('and(or(esta_mapeado.is.null,esta_mapeado.eq.false),not.and(tipo_publicacion.eq.catalogo,par_item_id.not.is.null))')
      .not('es_bundle', 'is', true)
      .not('tags', 'cs', '{bundle}')
      .eq('external_variation_id', '0')
      .order(orderBy, { ascending: false, nullsFirst: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);

    if (search.length >= 2) {
      q = q.or(
        `titulo.ilike.%${search}%,external_item_id.ilike.%${search}%,brand.ilike.%${search}%,model.ilike.%${search}%,seller_sku.ilike.%${search}%,ean.ilike.%${search}%,gtin.ilike.%${search}%`
      );
    }

    const { data: rows, count, error } = await q;
    if (error) throw error;

    const list = rows || [];

    // 2) Enriquecimiento: ¿la publicación tiene mapeo existente y si sí, sus artículos tienen costo vigente?
    const pubIds = list.map((r) => r.id);
    let mapMap = new Map<string, string[]>(); // publicacion_id -> [articulo_id]
    if (pubIds.length) {
      const { data: mapeos } = await supabase
        .from('mapeo_publicacion_articulo')
        .select('publicacion_id, articulo_id')
        .in('publicacion_id', pubIds);
      (mapeos || []).forEach((m: any) => {
        const arr = mapMap.get(m.publicacion_id) || [];
        arr.push(m.articulo_id);
        mapMap.set(m.publicacion_id, arr);
      });
    }

    const allArtIds = Array.from(new Set(Array.from(mapMap.values()).flat()));
    const costSet = new Set<string>();
    if (allArtIds.length) {
      const { data: costs } = await supabase
        .from('costos_articulo')
        .select('articulo_id')
        .in('articulo_id', allArtIds)
        .eq('vigente', true);
      (costs || []).forEach((c: any) => costSet.add(c.articulo_id));
    }

    // 3) Adjuntar señales de costo por fila
    const enriched = list.map((r: any) => {
      const arts = mapMap.get(r.id) || [];
      const conCosto = arts.filter((a) => costSet.has(a)).length;
      const sinCosto = arts.length - conCosto;
      return {
        ...r,
        _mapped_articulos: arts,
        _articulos_con_costo: conCosto,
        _articulos_sin_costo: sinCosto,
        _cost_status:
          arts.length === 0
            ? 'sin_mapeo'
            : sinCosto === 0
            ? 'costo_completo'
            : conCosto === 0
            ? 'sin_costo'
            : 'parcial',
      };
    });

    // 4) Sugerencia EN LOTE (rápida): señales fuertes (hermana/SKU/código/modelo) sin
    //    fuzzy. Evita ~50×4 queries por página. El modal individual sigue usando el
    //    motor completo (con fuzzy) para una sola publicación.
    const pubs: PublicacionSugerible[] = list.map((r: any) => ({
      id: r.id,
      external_item_id: r.external_item_id,
      seller_sku: r.seller_sku,
      seller_custom_field: r.seller_custom_field,
      ean: r.ean,
      gtin: r.gtin,
      upc: r.upc,
      model: r.model,
      brand: r.brand,
      titulo: r.titulo,
      marketplace_id: r.marketplace_id,
      id_producto_catalogo: r.id_producto_catalogo,
      par_item_id: r.par_item_id,
      tipo_publicacion: r.tipo_publicacion,
    }));

    const sugerenciaMap = await sugerirExactoEnLote(pubs);

    const enrichedConSugerencia = enriched
      .map((r: any) => ({ ...r, _sugerencia: sugerenciaMap.get(r.id) ?? null }))
      // Coincidencias primero (mayor score arriba); sin sugerencia al final.
      .sort((a: any, b: any) => (b._sugerencia?.score ?? -1) - (a._sugerencia?.score ?? -1));

    return NextResponse.json({
      total: count || 0,
      page,
      pageSize,
      orderBy,
      rows: enrichedConSugerencia,
    });
  } catch (e: any) {
    console.error('[api/publicaciones/pendientes] error', e);
    return NextResponse.json({ error: e?.message || 'error' }, { status: 500 });
  }
}
