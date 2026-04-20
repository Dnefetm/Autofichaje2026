import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin.from('importaciones_excel')
    .update({ estado: 'procesando', error_mensaje: null, filas_procesadas: 0, ultima_actividad: new Date().toISOString() })
    .eq('id', id).in('estado', ['error', 'cancelado']);
    
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  
  fetch(`${process.env.SUPABASE_URL}/functions/v1/procesar-importacion`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ importacion_id: id }),
  }).catch(() => {});
  
  return NextResponse.json({ ok: true });
}
