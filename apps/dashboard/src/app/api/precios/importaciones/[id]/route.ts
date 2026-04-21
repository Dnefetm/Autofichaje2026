import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  
  // Buscar config de storage antes de borrar
  const { data: imp } = await supabaseAdmin
    .from('importaciones_excel')
    .select('mapeo_columnas')
    .eq('id', id)
    .single();

  const { error } = await supabaseAdmin.from('importaciones_excel').delete().eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  
  const m = imp?.mapeo_columnas as any;
  if (m?._storage_path) {
    await supabaseAdmin.storage.from(m._bucket ?? 'excel-precios').remove([m._storage_path]).catch(console.error);
  }
  
  return NextResponse.json({ ok: true });
}
