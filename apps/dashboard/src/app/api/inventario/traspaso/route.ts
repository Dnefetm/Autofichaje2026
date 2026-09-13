import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

const ESTADOS = ['danado', 'devolucion', 'desecho', 'devolver'];

export async function POST(req: Request) {
  const supabase = await createRouteHandlerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || !body.articulo_id || !body.cantidad || !body.estado) {
    return NextResponse.json({ error: 'Faltan datos (articulo_id, cantidad, estado)' }, { status: 400 });
  }
  if (!ESTADOS.includes(body.estado)) {
    return NextResponse.json({ error: 'Estado inválido' }, { status: 400 });
  }
  if (!Number.isInteger(body.cantidad) || body.cantidad <= 0) {
    return NextResponse.json({ error: 'La cantidad debe ser un entero mayor a 0' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.rpc('fn_traspaso_stock', {
    p_articulo_id: body.articulo_id,
    p_cantidad: body.cantidad,
    p_estado: body.estado,
    p_ubicacion: body.ubicacion ?? '',
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
