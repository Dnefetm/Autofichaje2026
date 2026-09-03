import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { MAPEO_CAMPOS, ARTICULO_COLS, FICHA_COLS, isEmpty, valorFicha } from '@/lib/rellenar-ficha';

export const runtime = 'nodejs';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

const PRIORIDAD_ESTADO: Record<string, number> = { publicada: 0, revision: 1, borrador: 2 };

/**
 * POST /api/articulos/[id]/rellenar-desde-ficha
 * Body opcional: { ficha_id } (si no se manda, elige la mejor ficha automáticamente).
 * Devuelve el diff determinista artículo ↔ ficha (0 tokens): campos vacíos → 'agregar',
 * distintos → 'conflicto'. Ningún campo se auto-aplica.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: articuloId } = await params;
  if (!articuloId) return NextResponse.json({ error: 'articulo_id requerido' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const supabase = getSupabaseAdmin();

  // 1. Artículo
  const { data: articulo } = await supabase.from('articulos').select(ARTICULO_COLS).eq('articulo_id', articuloId).single();
  if (!articulo) return NextResponse.json({ error: 'Artículo no encontrado' }, { status: 404 });

  // 2. Ficha: la pedida, o la mejor (publicada > revisión > borrador, más reciente)
  let ficha: any = null;
  if (body?.ficha_id) {
    const { data } = await supabase.from('fichas_tecnicas').select(FICHA_COLS).eq('id', body.ficha_id).single();
    ficha = data;
  } else {
    const { data } = await supabase
      .from('fichas_tecnicas')
      .select(FICHA_COLS)
      .eq('articulo_id', articuloId)
      .limit(10);
    const fichas = (data || []).sort((a: any, b: any) => {
      const pa = PRIORIDAD_ESTADO[a.estado] ?? 3;
      const pb = PRIORIDAD_ESTADO[b.estado] ?? 3;
      if (pa !== pb) return pa - pb;
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });
    ficha = fichas[0] || null;
  }

  if (!ficha) {
    return NextResponse.json({ error: 'No hay ficha técnica asociada a este artículo.', codigo: 'sin_ficha' }, { status: 404 });
  }

  // 3. Diff determinista
  const campos: any[] = [];
  for (const m of MAPEO_CAMPOS) {
    const vFicha = valorFicha(ficha, m);
    if (isEmpty(vFicha)) continue;
    const actual = (articulo as any)[m.articulo];

    if (isEmpty(actual)) {
      campos.push({ campo: m.articulo, label: m.label, tipo: m.tipo, sintetizable: m.sintetizable, accion: 'agregar', valor_actual: null, valor_ficha: vFicha });
    } else if (String(actual).trim() !== String(vFicha).trim()) {
      campos.push({ campo: m.articulo, label: m.label, tipo: m.tipo, sintetizable: m.sintetizable, accion: 'conflicto', valor_actual: actual, valor_ficha: vFicha });
    }
  }

  return NextResponse.json({
    ficha: { id: ficha.id, nombre_producto: ficha.nombre_producto, estado: ficha.estado },
    campos,
    total: campos.length,
  });
}
