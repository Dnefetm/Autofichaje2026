import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET /api/ventas/tickets/[id] — detalle de un ticket para imprimir
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;

  const { data: ticket, error } = await supabaseAdmin
    .from('tickets_venta')
    .select('*, pedido:pedidos(descuento_aplicado, estado, fecha), cliente:clientes(*), vendedor:vendedores(nombre)')
    .eq('id', id)
    .single();

  if (error || !ticket) return NextResponse.json({ error: 'Ticket no encontrado' }, { status: 404 });

  // Líneas con nombre del artículo
  const { data: items, error: errItems } = await supabaseAdmin
    .from('pedido_items')
    .select('id, articulo_id, proveedor_corto, marca, modelo, descripcion, cantidad, cantidad_surtida, fuente_pendiente, precio_menudeo, descuento, subtotal, articulo:articulos(nombre)')
    .eq('pedido_id', (ticket as any).pedido_id);

  if (errItems) return NextResponse.json({ error: errItems.message }, { status: 500 });

  return NextResponse.json({ ticket, items: items || [] });
}
