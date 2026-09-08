import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET /api/ventas/rangos — lista de rangos (todos, con flag activo)
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('rangos_descuento')
    .select('id, nombre, porcentaje, activo')
    .order('porcentaje', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rangos: data || [] });
}

// POST /api/ventas/rangos — crear
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { nombre, porcentaje } = body || {};
  if (!nombre || !String(nombre).trim()) {
    return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 });
  }
  const pct = Number(porcentaje);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return NextResponse.json({ error: 'Porcentaje inválido (0-100)' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('rangos_descuento')
    .insert({ nombre: String(nombre).trim(), porcentaje: pct })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, rango: data });
}

// PATCH /api/ventas/rangos — editar o desactivar (activo)
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, nombre, porcentaje, activo } = body || {};
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });

  const upd: Record<string, any> = {};
  if (nombre !== undefined) upd.nombre = String(nombre).trim();
  if (porcentaje !== undefined) {
    const pct = Number(porcentaje);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return NextResponse.json({ error: 'Porcentaje inválido (0-100)' }, { status: 400 });
    }
    upd.porcentaje = pct;
  }
  if (activo !== undefined) upd.activo = !!activo;

  const { data, error } = await supabaseAdmin
    .from('rangos_descuento')
    .update(upd)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, rango: data });
}
