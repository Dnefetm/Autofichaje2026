import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// POST /api/ventas/tickets — generar ticket a partir de un pedido
// Body: { pedido_id }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { pedido_id } = body || {};

  if (!pedido_id) return NextResponse.json({ error: 'Falta pedido_id' }, { status: 400 });

  // 1. Leer pedido
  const { data: pedido, error: errPed } = await supabaseAdmin
    .from('pedidos')
    .select('*')
    .eq('id', pedido_id)
    .single();

  if (errPed || !pedido) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 });

  // 2. Reservar stock (idempotente): clasifica líneas y reserva la parte física.
  const { error: errReserva } = await supabaseAdmin.rpc('pedido_reservar', { p_pedido_id: pedido_id });
  if (errReserva) return NextResponse.json({ error: errReserva.message }, { status: 500 });

  // 3. Si ya tiene ticket, devolverlo (idempotente)
  const { data: existente } = await supabaseAdmin
    .from('tickets_venta')
    .select('id, folio')
    .eq('pedido_id', pedido_id)
    .maybeSingle();

  if (existente) {
    return NextResponse.json({ ok: true, ticket_id: (existente as any).id, folio: (existente as any).folio });
  }

  // 4. Folio único (timestamp)
  const folio = 'TKT-' + new Date().getTime();

  // 5. Insertar ticket (el pedido ya quedó 'confirmado' por pedido_reservar)
  const { data: ticket, error: errTkt } = await supabaseAdmin
    .from('tickets_venta')
    .insert({
      pedido_id,
      cliente_id: (pedido as any).cliente_id,
      vendedor_id: (pedido as any).vendedor_id || null,
      folio,
      total: (pedido as any).total,
    })
    .select()
    .single();

  if (errTkt) return NextResponse.json({ error: errTkt.message }, { status: 500 });

  return NextResponse.json({ ok: true, ticket_id: (ticket as any).id, folio });
}
