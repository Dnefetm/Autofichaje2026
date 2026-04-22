import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const ACTIVOS = ['pendiente_mapeo', 'mapeando', 'procesando'] as const;

export async function POST(req: NextRequest) {
const body = await req.json().catch(() => ({}));
const proveedor = (body?.proveedor ?? '').toString().trim();
const id = (body?.id ?? '').toString().trim();
if (!proveedor && !id) {
return NextResponse.json({ ok: false, error: 'proveedor o id requerido' }, { status: 400 });
}

let q = supabaseAdmin.from('importaciones_excel').delete();

if (id) {
  q = q.eq('id', id);
} else {
  q = q.eq('proveedor', proveedor);
}

const { data, error } = await q.in('estado', ACTIVOS as unknown as string[]).select('id, proveedor, estado');

if (error) {
return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
}
return NextResponse.json({ ok: true, canceladas: data?.length ?? 0, items: data ?? [] });
}
