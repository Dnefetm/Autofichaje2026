import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET /api/ventas/pedidos/[id] — detalle de un pedido (con líneas y ticket)
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { data: pedido, error } = await supabaseAdmin
    .from('pedidos')
    .select('*, cliente:clientes(*), vendedor:vendedores(nombre), ticket:tickets_venta(id)')
    .eq('id', params.id)
    .single();

  if (error || !pedido) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 });

  const { data: items, error: errItems } = await supabaseAdmin
    .from('pedido_items')
    .select('id, articulo_id, proveedor_corto, marca, modelo, descripcion, cantidad, cantidad_surtida, fuente_pendiente, precio_menudeo, descuento, subtotal, articulo:articulos(nombre)')
    .eq('pedido_id', params.id);

  if (errItems) return NextResponse.json({ error: errItems.message }, { status: 500 });

  return NextResponse.json({ pedido, items: items || [] });
}
