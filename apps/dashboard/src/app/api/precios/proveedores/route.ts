import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET: listar proveedores (con flag archivado)
export async function GET() {
    const { data, error } = await supabaseAdmin
        .from('proveedores')
        .select('nombre, archivado, creado_el')
        .order('nombre', { ascending: true });
    if (error) {
        // Si la tabla no existe todavía (migración no aplicada), devolver vacío sin fallar.
        if (error.code === '42P01') return NextResponse.json({ proveedores: [] });
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ proveedores: data ?? [] });
}

// POST: crear proveedor
export async function POST(req: Request) {
    const body = await req.json().catch(() => ({}));
    const nombre = (body?.nombre ?? '').toString().trim();
    if (!nombre) return NextResponse.json({ error: 'nombre requerido' }, { status: 400 });

    const { data, error } = await supabaseAdmin
        .from('proveedores')
        .insert({ nombre })
        .select()
        .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
}

// PATCH: archivar / desarchivar
export async function PATCH(req: Request) {
    const body = await req.json().catch(() => ({}));
    const nombre = (body?.nombre ?? '').toString().trim();
    if (!nombre) return NextResponse.json({ error: 'nombre requerido' }, { status: 400 });

    const { data, error } = await supabaseAdmin
        .from('proveedores')
        .update({ archivado: !!body.archivado, actualizado_el: new Date().toISOString() })
        .eq('nombre', nombre)
        .select()
        .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
}
