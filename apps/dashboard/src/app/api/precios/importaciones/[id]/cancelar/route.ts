import { friendlyError } from '@/lib/friendlyError';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  
  const { error } = await supabaseAdmin
    .from('importaciones_excel')
    .update({ 
        estado: 'cancelado',
        error_mensaje: 'Cancelado manualmente por el usuario',
        ultima_actividad: new Date().toISOString()
    })
    .eq('id', id);
  
  if (error) return NextResponse.json({ ok: false, error: friendlyError(error) }, { status: 500 });
  return NextResponse.json({ ok: true });
}
