import { friendlyError } from '@/lib/friendlyError';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET: listar proveedores (con flag archivado y código corto)
export async function GET() {
    const { data, error } = await supabaseAdmin
        .from('proveedores')
        .select('nombre, codigo_corto, archivado, creado_el')
        .order('nombre', { ascending: true });
    if (error) {
        // Si la tabla no existe todavía (migración no aplicada), devolver vacío sin fallar.
        if (error.code === '42P01') return NextResponse.json({ proveedores: [] });
        return NextResponse.json({ error: friendlyError(error) }, { status: 500 });
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
        .insert({ nombre, codigo_corto: body?.codigo_corto || null })
        .select()
        .single();
    if (error) return NextResponse.json({ error: friendlyError(error) }, { status: 500 });
    return NextResponse.json(data);
}

// PATCH: editar código corto y/o archivar / desarchivar
export async function PATCH(req: Request) {
    const body = await req.json().catch(() => ({}));
    const nombre = (body?.nombre ?? '').toString().trim();
    if (!nombre) return NextResponse.json({ error: 'nombre requerido' }, { status: 400 });

    const upd: Record<string, any> = { actualizado_el: new Date().toISOString() };
    if (body.archivado !== undefined) upd.archivado = !!body.archivado;
    if (body.codigo_corto !== undefined) {
        const cod = (body.codigo_corto ?? '').toString().trim();
        upd.codigo_corto = cod || null;
    }

    const { data, error } = await supabaseAdmin
        .from('proveedores')
        .update(upd)
        .eq('nombre', nombre)
        .select()
        .single();
    if (error) return NextResponse.json({ error: friendlyError(error) }, { status: 500 });
    return NextResponse.json(data);
}
