import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/vinculacion/mapeo-mixto
 * Lista los casos de "mapeo mixto": grupos de publicaciones que comparten
 * (marketplace_id, user_product_id) donde al menos una está mapeada y al menos
 * una no. Solo LECTURA — la vinculación la decide el operador en la UI.
 */
export async function GET() {
  try {
    // 1. Todas las publicaciones con user_product_id (grupos potenciales de condición de venta)
    const { data: pubs, error } = await supabaseAdmin
      .from('publicaciones_externas')
      .select('id, marketplace_id, user_product_id, external_item_id, titulo, listing_type_id, status_externo, esta_mapeado')
      .not('user_product_id', 'is', null);
    if (error) throw error;

    // 2. Agrupar por (marketplace_id, user_product_id)
    const grupos = new Map<string, any[]>();
    for (const p of pubs || []) {
      const key = `${p.marketplace_id}::${p.user_product_id}`;
      const list = grupos.get(key);
      if (list) list.push(p);
      else grupos.set(key, [p]);
    }

    // 3. Filtrar grupos mixtos
    const mixtos: { marketplace_id: string; user_product_id: string; mapeadas: any[]; sinMapear: any[] }[] = [];
    const mapeadasIds: string[] = [];
    for (const members of grupos.values()) {
      if (members.length <= 1) continue;
      const mapeadas = members.filter((p) => p.esta_mapeado === true);
      const sinMapear = members.filter((p) => p.esta_mapeado !== true);
      if (mapeadas.length === 0 || sinMapear.length === 0) continue;
      mixtos.push({ marketplace_id: mapeadas[0].marketplace_id, user_product_id: mapeadas[0].user_product_id, mapeadas, sinMapear });
      mapeadasIds.push(...mapeadas.map((p) => p.id));
    }

    // 4. Mapeos y artículos en 1 sola query por tabla (evita N+1)
    const { data: mapeos } = await supabaseAdmin
      .from('mapeo_publicacion_articulo')
      .select('publicacion_id, articulo_id, cantidad_requerida, sincronizar_stock')
      .in('publicacion_id', mapeadasIds);

    const articuloIds = [...new Set((mapeos || []).map((m) => m.articulo_id))];
    const { data: articulos } = await supabaseAdmin
      .from('articulos')
      .select('articulo_id, nombre, caja_madre')
      .in('articulo_id', articuloIds);

    const artMap = new Map((articulos || []).map((a) => [a.articulo_id, a]));
    const mapPorPub = new Map((mapeos || []).map((m) => [m.publicacion_id, m]));

    const casos = mixtos.map((g) => {
      const mapeada = g.mapeadas[0];
      const mapRow = mapPorPub.get(mapeada.id) || null;
      const articulo = mapRow?.articulo_id ? (artMap.get(mapRow.articulo_id) || null) : null;
      return {
        marketplace_id: g.marketplace_id,
        user_product_id: g.user_product_id,
        mapeada: { ...mapeada, articulo_id: mapRow?.articulo_id || null, cantidad_requerida: mapRow?.cantidad_requerida ?? 1, sincronizar_stock: mapRow?.sincronizar_stock !== false, articulo },
        sin_mapear: g.sinMapear,
      };
    });

    return NextResponse.json({ ok: true, total: casos.length, casos });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Error al listar mapeos mixtos' }, { status: 500 });
  }
}
