import { friendlyError } from '@/lib/friendlyError';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin.from('importaciones_excel')
    .update({ estado: 'procesando', error_mensaje: null, filas_procesadas: 0, ultima_actividad: new Date().toISOString() })
    .eq('id', id).in('estado', ['error', 'cancelado']);
    
  if (error) return NextResponse.json({ ok: false, error: friendlyError(error) }, { status: 500 });
  
  const runRes = await supabaseAdmin.functions.invoke('procesar-importacion', {
    body: { importacion_id: id }
  });
  return NextResponse.json({ ok: true });
}
