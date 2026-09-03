import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { MAPEO_CAMPOS } from '@/lib/rellenar-ficha';

export const runtime = 'nodejs';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/**
 * POST /api/articulos/[id]/rellenar-aplicar
 * Body: { campos_aceptados: { campo: valor } }
 * Aplica solo los campos aceptados (whitelist) sobre articulos. Determinista: 0 tokens.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: articuloId } = await params;
  if (!articuloId) return NextResponse.json({ error: 'articulo_id requerido' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const camposAceptados = body?.campos_aceptados as Record<string, any> | undefined;
  if (!camposAceptados || typeof camposAceptados !== 'object' || Object.keys(camposAceptados).length === 0) {
    return NextResponse.json({ error: 'campos_aceptados no puede estar vacío' }, { status: 400 });
  }

  const numericos = new Set(MAPEO_CAMPOS.filter((m) => m.tipo === 'numero').map((m) => m.articulo));
  const permitidos = new Set(MAPEO_CAMPOS.map((m) => m.articulo));

  const update: Record<string, any> = {};
  for (const [campo, valor] of Object.entries(camposAceptados)) {
    if (!permitidos.has(campo)) continue;
    if (numericos.has(campo)) {
      const n = Number(valor);
      update[campo] = valor === null || valor === '' || isNaN(n) ? null : n;
    } else {
      update[campo] = valor === null || valor === '' ? null : String(valor);
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No hay campos válidos que aplicar' }, { status: 400 });
  }

  const { error } = await supabase.from('articulos').update(update).eq('articulo_id', articuloId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, campos_aplicados: Object.keys(update) });
}
