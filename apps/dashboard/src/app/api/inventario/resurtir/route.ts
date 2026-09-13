import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET /api/inventario/resurtir?dias=60
// Devuelve artículos cuyo stock vendible es menor a lo vendido en los últimos N días.
// "resurtir" = physical_stock < SUM(egresos tipo 'venta' en los últimos N días).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const dias = Number(url.searchParams.get('dias')) || 60;
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

  try {
    // 1) stock vendible actual
    const stock = new Map<string, number>();
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('inventory_snapshot')
        .select('sku, physical_stock')
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data) stock.set(r.sku, r.physical_stock ?? 0);
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    // 2) ventas en el periodo (agregado en memoria)
    const ventas = new Map<string, number>();
    offset = 0;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('egresos')
        .select('articulo_id, cantidad')
        .eq('tipo_egreso', 'venta')
        .gte('fecha', desde)
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data) {
        if (!r.articulo_id) continue;
        ventas.set(r.articulo_id, (ventas.get(r.articulo_id) ?? 0) + (r.cantidad ?? 0));
      }
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    // 3) artículos a resurtir: stock < ventas
    const aResurtir: { articulo_id: string; stock: number; vendido: number }[] = [];
    for (const [articuloId, vendido] of ventas) {
      const actual = stock.get(articuloId) ?? 0;
      if (actual < vendido) aResurtir.push({ articulo_id: articuloId, stock: actual, vendido });
    }

    // 4) nombres de los artículos
    const nombres = new Map<string, string>();
    if (aResurtir.length > 0) {
      const ids = aResurtir.map((a) => a.articulo_id);
      const chunks = [];
      for (let i = 0; i < ids.length; i += 500) chunks.push(ids.slice(i, i + 500));
      for (const chunk of chunks) {
        const { data, error } = await supabaseAdmin
          .from('articulos')
          .select('articulo_id, nombre')
          .in('articulo_id', chunk);
        if (error) throw error;
        for (const r of data ?? []) nombres.set(r.articulo_id, r.nombre ?? r.articulo_id);
      }
    }

    const resultado = aResurtir
      .map((a) => ({ ...a, nombre: nombres.get(a.articulo_id) ?? a.articulo_id }))
      .sort((x, y) => (y.vendido - y.stock) - (x.vendido - x.stock));

    return NextResponse.json({ dias, total: resultado.length, items: resultado });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'error' }, { status: 500 });
  }
}
