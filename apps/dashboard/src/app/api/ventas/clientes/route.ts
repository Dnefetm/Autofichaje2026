import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RFC_RE = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{2,3}$/i;

// Valida nombre/email/rfc. Devuelve el mensaje de error o null si está bien.
function validar(nombre?: any, email?: any, rfc?: any): string | null {
  if (nombre !== undefined && !String(nombre).trim()) return 'El nombre es obligatorio';
  if (email && !EMAIL_RE.test(String(email))) return 'Email inválido';
  if (rfc && !RFC_RE.test(String(rfc))) return 'RFC inválido (12-13 caracteres: 4 letras + 6 dígitos + homoclave)';
  return null;
}

async function nombreDuplicado(nombre: string, excluirId?: string): Promise<boolean> {
  let q = supabaseAdmin.from('clientes').select('id').ilike('nombre', nombre.trim()).limit(1);
  if (excluirId) q = q.neq('id', excluirId);
  const { data } = await q;
  return !!data && data.length > 0;
}

// GET /api/ventas/clientes — lista (activos por defecto; ?todos=1 incluye inactivos)
export async function GET(req: NextRequest) {
  const todos = req.nextUrl.searchParams.get('todos') === '1';
  let q = supabaseAdmin
    .from('clientes')
    .select('*, rango:rangos_descuento(nombre, porcentaje), vendedor:vendedores(nombre)')
    .order('nombre', { ascending: true });
  if (!todos) q = q.eq('activo', true);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ clientes: data || [] });
}

// POST /api/ventas/clientes — registrar un cliente
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { nombre, contacto, telefono, direccion, email, rfc, razon_social, vendedor_id, rango_descuento_id } = body || {};

  const err = validar(nombre, email, rfc);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const dup = await nombreDuplicado(String(nombre).trim());
  if (dup) return NextResponse.json({ error: 'Ya existe un cliente con ese nombre' }, { status: 409 });

  const { data, error } = await supabaseAdmin
    .from('clientes')
    .insert({
      nombre: String(nombre).trim(),
      contacto: contacto || null,
      telefono: telefono || null,
      direccion: direccion || null,
      email: email || null,
      rfc: rfc || null,
      razon_social: razon_social || null,
      vendedor_id: vendedor_id || null,
      rango_descuento_id: rango_descuento_id || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Ya existe un cliente con ese nombre' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, cliente: data });
}

// PUT /api/ventas/clientes — editar o desactivar (activo)
export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, nombre, contacto, telefono, direccion, email, rfc, razon_social, vendedor_id, rango_descuento_id, activo } = body || {};
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });

  const err = validar(nombre, email, rfc);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  if (nombre !== undefined) {
    const dup = await nombreDuplicado(String(nombre).trim(), id);
    if (dup) return NextResponse.json({ error: 'Ya existe otro cliente con ese nombre' }, { status: 409 });
  }

  const upd: Record<string, any> = {};
  if (nombre !== undefined) upd.nombre = String(nombre).trim();
  if (contacto !== undefined) upd.contacto = contacto || null;
  if (telefono !== undefined) upd.telefono = telefono || null;
  if (direccion !== undefined) upd.direccion = direccion || null;
  if (email !== undefined) upd.email = email || null;
  if (rfc !== undefined) upd.rfc = rfc || null;
  if (razon_social !== undefined) upd.razon_social = razon_social || null;
  if (vendedor_id !== undefined) upd.vendedor_id = vendedor_id || null;
  if (rango_descuento_id !== undefined) upd.rango_descuento_id = rango_descuento_id || null;
  if (activo !== undefined) upd.activo = !!activo;

  const { data, error } = await supabaseAdmin
    .from('clientes')
    .update(upd)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Ya existe un cliente con ese nombre' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, cliente: data });
}
