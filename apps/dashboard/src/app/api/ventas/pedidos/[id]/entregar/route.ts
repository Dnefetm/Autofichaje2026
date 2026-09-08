import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// POST /api/ventas/pedidos/[id]/entregar — marcar entregado (sin efecto en stock)
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from('pedidos')
    .update({ estado: 'entregado' })
    .eq('id', id)
    .eq('estado', 'surtido')
    .select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Solo se puede entregar un pedido que ya fue surtido' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
