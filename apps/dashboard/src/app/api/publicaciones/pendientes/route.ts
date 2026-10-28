import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  multiplicadorDePublicacion,
  sugerirExactoEnLote,
  type PublicacionSugerible,
  type Sugerencia,
} from '@/lib/vinculacion/sugerencias';

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

    const selectCols = `id, external_item_id, titulo, brand, model, precio_venta, visits_30d,
         url_imagen, marketplace_id, marketplace_configs(account_name), ean, gtin, upc, seller_sku, seller_custom_field,
         domain_id, condition, tipo_publicacion, variation_attributes, par_item_id, id_producto_catalogo,
         es_bundle, tags,
         sync_disabled, sync_disabled_reason, pricing_status, sale_price_calculated,
         actualizado_el`;

    let list: any[] = [];
    let count: number | null = 0;
    const sqlSugerenciaMap = new Map<string, Omit<Sugerencia, 'cantidad_sugerida'> | null>();
    let usedUnifiedSqlScore = false;

    const { data: preSorted, error: rpcError } = await supabase.rpc('fn_cola_mapeo_pendientes', {
      p_search: search,
      p_order_by: orderBy,
      p_limit: pageSize,
      p_offset: page * pageSize,
    });

    if (!rpcError && Array.isArray(preSorted)) {
      usedUnifiedSqlScore = true;
      count = preSorted.length > 0 ? Number(preSorted[0].total_count || 0) : 0;
      const orderedIds = preSorted.map((x: any) => x.pub_id).filter(Boolean);

      for (const row of preSorted) {
        if (row.pub_id && row.art_id && row.sug_score != null && Number(row.sug_score) > 0) {
          sqlSugerenciaMap.set(row.pub_id, {
            articulo_id: row.art_id,
            nombre: row.art_nombre ?? '',
            marca: row.art_marca ?? null,
            modelo: row.art_modelo ?? null,
            variante: row.art_variante ?? null,
            codigo_universal: row.art_codigo_universal ?? null,
            caja_madre: row.art_caja_madre ?? null,
            score: Number(row.sug_score),
            metodo: row.sug_metodo ?? 'marca_modelo',
            motivo: row.sug_motivo ?? 'Coincidencia de catálogo',
          });
        } else if (row.pub_id) {
          sqlSugerenciaMap.set(row.pub_id, null);
        }
      }

      if (orderedIds.length > 0) {
        const { data: fetchedRows, error: fetchErr } = await supabase
          .from('publicaciones_externas')
          .select(selectCols)
          .in('id', orderedIds);
        if (fetchErr) throw fetchErr;
        const byId = new Map((fetchedRows || []).map((r: any) => [r.id, r]));
        list = orderedIds.map((id: string) => byId.get(id)).filter(Boolean);
      }
    } else {
      let q = supabase
        .from('publicaciones_externas')
        .select(selectCols, { count: 'estimated' })
        .or('and(or(esta_mapeado.is.null,esta_mapeado.eq.false),not.and(tipo_publicacion.eq.catalogo,par_item_id.not.is.null))')
        .not('es_bundle', 'is', true)
        .not('tags', 'cs', '{bundle}')
        .not('channels', 'cs', '{private}')
        .eq('external_variation_id', '0')
        .order(orderBy, { ascending: false, nullsFirst: false })
        .range(page * pageSize, page * pageSize + pageSize - 1);

      if (search.length >= 2) {
        q = q.or(
          `titulo.ilike.%${search}%,external_item_id.ilike.%${search}%,brand.ilike.%${search}%,model.ilike.%${search}%,seller_sku.ilike.%${search}%,ean.ilike.%${search}%,gtin.ilike.%${search}%`
        );
      }

      const { data: rows, count: fallbackCount, error } = await q;
      if (error) throw error;
      list = rows || [];
      count = fallbackCount || 0;
    }

    const pubIds = list.map((r) => r.id);
    const mapMap = new Map<string, string[]>();
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

    let enrichedConSugerencia: any[];
    if (usedUnifiedSqlScore) {
      enrichedConSugerencia = enriched.map((r: any) => {
        const baseSug = sqlSugerenciaMap.get(r.id) ?? null;
        const _sugerencia: Sugerencia | null = baseSug
          ? { ...baseSug, cantidad_sugerida: multiplicadorDePublicacion(r) }
          : null;
        return { ...r, _sugerencia };
      });
    } else {
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
      enrichedConSugerencia = enriched
        .map((r: any) => ({ ...r, _sugerencia: sugerenciaMap.get(r.id) ?? null }))
        .sort((a: any, b: any) => (b._sugerencia?.score ?? -1) - (a._sugerencia?.score ?? -1));
    }

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
