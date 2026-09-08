import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET /api/ventas/pedidos/[id] — detalle de un pedido (con líneas, ticket y stock reservado)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data: pedido, error } = await supabaseAdmin
    .from('pedidos')
    .select('*, cliente:clientes(nombre, telefono), vendedor:vendedores(nombre), ticket:tickets_venta(id)')
    .eq('id', id)
    .single();

  if (error || !pedido) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 });

  const { data: items, error: errItems } = await supabaseAdmin
    .from('pedido_items')
    .select('id, articulo_id, proveedor_corto, marca, modelo, descripcion, cantidad, cantidad_surtida, fuente_pendiente, precio_menudeo, descuento, subtotal')
    .eq('pedido_id', id);

  if (errItems) return NextResponse.json({ error: errItems.message }, { status: 500 });

  // Stock reservado (estado 'activa') de este pedido
  const itemIds = (items || []).map((i: any) => i.id);
  let reservado = 0;
  if (itemIds.length) {
    const { data: reservas } = await supabaseAdmin
      .from('reservaciones_stock')
      .select('cantidad, estado')
      .in('pedido_item_id', itemIds)
      .eq('origen', 'pedido');
    for (const r of reservas || []) {
      if (r.estado === 'activa') reservado += Number(r.cantidad) || 0;
    }
  }

  return NextResponse.json({ pedido, items: items || [], reservado });
}
