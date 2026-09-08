import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET /api/ventas/vendedores — lista de vendedores (todos, con flag activo)
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('vendedores')
    .select('id, nombre, email, telefono, activo')
    .order('nombre', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ vendedores: data || [] });
}

// POST /api/ventas/vendedores — crear
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { nombre, email, telefono } = body || {};
  if (!nombre || !String(nombre).trim()) {
    return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('vendedores')
    .insert({ nombre: String(nombre).trim(), email: email || null, telefono: telefono || null })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, vendedor: data });
}

// PATCH /api/ventas/vendedores — editar o desactivar (activo)
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, nombre, email, telefono, activo } = body || {};
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });

  const upd: Record<string, any> = {};
  if (nombre !== undefined) upd.nombre = String(nombre).trim();
  if (email !== undefined) upd.email = email || null;
  if (telefono !== undefined) upd.telefono = telefono || null;
  if (activo !== undefined) upd.activo = !!activo;

  const { data, error } = await supabaseAdmin
    .from('vendedores')
    .update(upd)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, vendedor: data });
}
