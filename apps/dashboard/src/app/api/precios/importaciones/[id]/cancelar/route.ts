import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { data, error } = await supabaseAdmin.rpc('fn_cancelar_importacion', { p_id: id });
  
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
