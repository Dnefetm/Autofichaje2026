import { friendlyError } from '@/lib/friendlyError';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const proveedor = searchParams.get('proveedor');
  const estado = searchParams.get('estado');

  await supabaseAdmin.rpc('fn_recuperar_importaciones_colgadas');

  let q = supabaseAdmin.from('v_importaciones_panel').select('*');
  if (proveedor) q = q.eq('proveedor', proveedor);
  if (estado) q = q.eq('estado', estado);

  const { data, error } = await q;

  if (error) return NextResponse.json({ ok: false, error: friendlyError(error) }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}
