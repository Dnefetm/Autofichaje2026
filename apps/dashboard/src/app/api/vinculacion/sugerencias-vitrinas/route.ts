import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sugerirPublicaciones, type ArticuloSugerible } from '@/lib/vinculacion/sugerencias';

export const dynamic = 'force-dynamic';

/**
 * Sugerencias de vidrieras para un artículo (flujo catálogo → vidriera).
 * Devuelve publicaciones sin mapear que coinciden con el artículo, con el mismo
 * motor de señales que el flujo inverso (SKU / código / marca+modelo / alias / fuzzy).
 */
export async function GET(req: NextRequest) {
  try {
    const articuloId = (req.nextUrl.searchParams.get('articulo_id') || '').trim();
    if (!articuloId) {
      return NextResponse.json({ error: 'articulo_id requerido' }, { status: 400 });
    }

    const { data: art } = await supabaseAdmin
      .from('articulos')
      .select('articulo_id, nombre, marca, modelo, codigo_universal')
      .eq('articulo_id', articuloId)
      .single();

    if (!art) return NextResponse.json({ rows: [] });

    const rows = await sugerirPublicaciones(art as ArticuloSugerible);
    return NextResponse.json({ rows });
  } catch (e: any) {
    console.error('[api/vinculacion/sugerencias-vitrinas] error', e);
    return NextResponse.json({ error: e?.message || 'error' }, { status: 500 });
  }
}
