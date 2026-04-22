import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;

    // Obtener proveedor de la importación
    const { data: imp, error: fetchErr } = await supabaseAdmin
      .from('importaciones_excel')
      .select('proveedor, estado')
      .eq('id', id)
      .single();

    if (fetchErr || !imp) {
      return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 });
    }

    if (imp.estado !== 'en_revision') {
      return NextResponse.json({ ok: false, error: 'La importación no está en revisión' }, { status: 400 });
    }

    // Call RPC to consolidate
    const { error: rpcErr } = await supabaseAdmin.rpc('fn_consolidar_revision_importacion', {
      p_importacion_id: id,
      p_proveedor: imp.proveedor
    });

    if (rpcErr) {
      throw new Error(rpcErr.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message || 'Error al consolidar la importación' },
      { status: 500 }
    );
  }
}
