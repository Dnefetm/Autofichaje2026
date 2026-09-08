import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// POST /api/ventas/pedidos/[id]/surtir — surtir lo reservado físicamente (egreso + consume reserva)
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await supabaseAdmin.rpc('pedido_surtir', { p_pedido_id: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
