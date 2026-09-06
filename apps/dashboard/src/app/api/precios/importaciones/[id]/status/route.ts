import { friendlyError } from '@/lib/friendlyError';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { data, error } = await supabaseAdmin.from('v_importaciones_panel')
    .select('estado,filas_procesadas,total_filas,pct_progreso,pct_match,filas_con_match,error_mensaje,ultima_actividad')
    .eq('id', id).single();
    
  if (error) return NextResponse.json({ ok: false, error: friendlyError(error) }, { status: 404 });
  return NextResponse.json({ ok: true, data });
}
