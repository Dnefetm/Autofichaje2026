import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/mapa/salud -> conteos reales por tabla/vista para el mapa vivo
const TABLAS = [
'importaciones_excel','listas_precios_raw','listas_precios_raw_staging','lista_precios_proveedor',
'listas_precios_proveedor','precios_proveedor_actual','matching_decisiones','matching_jobs',
'matching_resultados','proveedor_articulos_alias','costos_articulo','costos_pendientes',
'precio_recalc_queue','reglas_precio','pricing_rules','pricing_rule_v3','articulos','fichas_tecnicas',
'ficha_extracciones','ficha_pdfs','ficha_imagenes','autoficha_borradores','publicaciones_externas',
'mapeo_publicacion_articulo','precios_publicacion','precios_publicados','marketplace_prices',
'marketplace_settlements','meli_webhook_events','webhook_buffer','ml_publicacion_sync_queue',
'sync_logs','historial_cambios_precio','ordenes','orden_items','inventory_snapshot',
'reservaciones_stock','egresos','ingresos'
];

async function contar(tabla: string): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from(tabla)
    .select('*', { count: 'exact', head: true });
  if (error) return null;
  return count ?? 0;
}

export async function GET() {
  try {
    const pares = await Promise.all(
      TABLAS.map(async (t) => [t, await contar(t)] as const)
    );
    const conteos: Record<string, number | null> = {};
    for (const [t, n] of pares) conteos[t] = n;
    return NextResponse.json({ ok: true, generado: new Date().toISOString(), conteos });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
