import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET /api/ventas/pedidos — lista de pedidos recientes (con ticket para reimprimir)
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('pedidos')
    .select('*, cliente:clientes(nombre), vendedor:vendedores(nombre), ticket:tickets_venta(id)')
    .order('creado_el', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pedidos: data || [] });
}

// POST /api/ventas/pedidos — crear pedido aplicando el descuento del cliente
// Body: { cliente_id, vendedor_id?, items: [{ tipo, articulo_id, cantidad, precio_menudeo, ... }] }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { cliente_id, vendedor_id, items } = body || {};

  if (!cliente_id) return NextResponse.json({ error: 'Falta cliente_id' }, { status: 400 });
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'El pedido no tiene artículos' }, { status: 400 });
  }

  // Validación: cantidad entera >= 1 y precio >= 0 (0 = "precio pendiente", permitido)
  for (const it of items as any[]) {
    const cantidad = Number(it.cantidad);
    const precio = Number(it.precio_menudeo);
    if (!Number.isInteger(cantidad) || cantidad < 1) {
      return NextResponse.json({ error: 'Cantidad inválida (debe ser un entero ≥ 1)' }, { status: 400 });
    }
    if (!Number.isFinite(precio) || precio < 0) {
      return NextResponse.json({ error: 'Precio de menudeo inválido (no puede ser negativo)' }, { status: 400 });
    }
  }

  // 1. Leer el rango de descuento del cliente
  const { data: cliente, error: errCli } = await supabaseAdmin
    .from('clientes')
    .select('id, rango_descuento_id, rango:rangos_descuento(porcentaje)')
    .eq('id', cliente_id)
    .single();

  if (errCli || !cliente) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });

  const porcentaje = Number((cliente as any).rango?.porcentaje || 0);

  // 2. Calcular subtotales (precio_menudeo * cantidad * (1 - descuento/100))
  //    Soporta DOS tipos de item:
  //      tipo='catalogo'  → articulo_id + nombre (snapshot)
  //      tipo='proveedor' → proveedor + marca + modelo + descripcion (snapshot)
  let total = 0;
  const lineas = (items as any[]).map((it) => {
    const cantidad = Number(it.cantidad);
    const precio = Number(it.precio_menudeo);
    const subtotal = precio * cantidad * (1 - porcentaje / 100);
    total += subtotal;
    const base = {
      cantidad,
      precio_menudeo: precio,
      descuento: porcentaje,
      subtotal: Math.round(subtotal * 100) / 100,
    };
    if (it.tipo === 'proveedor') {
      return {
        ...base,
        articulo_id: it.articulo_id || null,
        proveedor: it.proveedor || null,
        proveedor_corto: it.proveedor_corto || null,
        marca: it.marca || null,
        modelo: it.modelo || null,
        descripcion: it.descripcion || null,
      };
    }
    return {
      ...base,
      articulo_id: String(it.articulo_id),
      descripcion: it.nombre || null, // snapshot del nombre del artículo
    };
  });
  total = Math.round(total * 100) / 100;

  // 3. Insertar pedido
  const { data: pedido, error: errPed } = await supabaseAdmin
    .from('pedidos')
    .insert({
      cliente_id,
      vendedor_id: vendedor_id || null,
      estado: 'borrador',
      descuento_aplicado: porcentaje,
      total,
    })
    .select()
    .single();

  if (errPed) return NextResponse.json({ error: errPed.message }, { status: 500 });

  // 4. Insertar líneas
  const { error: errItems } = await supabaseAdmin
    .from('pedido_items')
    .insert(lineas.map((l) => ({ ...l, pedido_id: (pedido as any).id })));

  if (errItems) return NextResponse.json({ error: errItems.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    pedido_id: (pedido as any).id,
    total,
    descuento_aplicado: porcentaje,
  });
}
