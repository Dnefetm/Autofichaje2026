import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET /api/ventas/compras/pendientes — líneas "Por surtir" para el encargado de compras
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('pedido_items')
    .select('id, cantidad, cantidad_surtida, fuente_pendiente, proveedor, proveedor_corto, marca, modelo, descripcion, articulo_id, pedido_id, pedido:pedidos(id, fecha, cliente_id, cliente:clientes(nombre))')
    .not('fuente_pendiente', 'is', null)
    .limit(300);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lineas: data || [] });
}
