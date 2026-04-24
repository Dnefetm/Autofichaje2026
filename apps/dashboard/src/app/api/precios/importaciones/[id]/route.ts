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

  // Borrado manual en cascada para evadir problemas de FK faltantes en producción
  await supabaseAdmin.from('importacion_eventos').delete().eq('importacion_id', id);
  await supabaseAdmin.from('matching_jobs').delete().eq('importacion_id', id);
  await supabaseAdmin.from('costos_articulo').delete().eq('importacion_id', id);
  await supabaseAdmin.from('matching_decisiones').delete().eq('importacion_id', id);
  await supabaseAdmin.from('listas_precios_raw').delete().eq('importacion_id', id);

  const { error } = await supabaseAdmin.from('importaciones_excel').delete().eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  
  const m = imp?.mapeo_columnas as any;
  if (m?._storage_path) {
    await supabaseAdmin.storage.from(m._bucket ?? 'excel-precios').remove([m._storage_path]).catch(console.error);
  }
  
  return NextResponse.json({ ok: true });
}
