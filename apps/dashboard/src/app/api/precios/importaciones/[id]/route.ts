import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { data, error } = await supabaseAdmin.rpc('fn_eliminar_importacion', { p_id: id });
  
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ ok: false, error: data?.error ?? 'No encontrada' }, { status: 404 });
  
  if (data.storage_path) {
    await supabaseAdmin.storage.from(data.storage_bucket ?? 'excel-precios').remove([data.storage_path]);
  }
  
  return NextResponse.json(data);
}
