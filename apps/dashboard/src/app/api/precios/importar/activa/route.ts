import { friendlyError } from '@/lib/friendlyError';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const ACTIVOS = ['pendiente_mapeo', 'mapeando', 'procesando'] as const;

export async function GET(req: NextRequest) {
  const proveedor = req.nextUrl.searchParams.get('proveedor')?.trim();
  if (!proveedor) {
    return NextResponse.json({ ok: false, error: 'proveedor requerido' }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin
    .from('importaciones_excel')
    .select('id, proveedor, estado, creado_el, nombre_archivo, total_filas, filas_procesadas')
    .eq('proveedor', proveedor)
    .in('estado', ACTIVOS as unknown as string[])
    .order('creado_el', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ ok: false, error: friendlyError(error) }, { status: 500 });
  }
  return NextResponse.json({ ok: true, activa: data ?? null });
}
