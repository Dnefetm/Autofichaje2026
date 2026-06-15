import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// GET /api/fichas?page=1&limit=20&estado=&q=
// Lista paginada de fichas_tecnicas con JOIN a articulos

export const runtime = 'nodejs';

function getSupabase() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const page   = Math.max(1, parseInt(searchParams.get('page')  || '1'));
    const limit  = Math.min(50, parseInt(searchParams.get('limit') || '20'));
    const estado = searchParams.get('estado') || '';
    const q      = searchParams.get('q') || '';
    const offset = (page - 1) * limit;

    const supabase = getSupabase();

    // Traemos fichas_tecnicas con join a articulos
    let query = supabase
        .from('fichas_tecnicas')
        .select(`
            id,
            estado,
            nombre_producto,
            descripcion,
            articulo_id,
            created_at,
            articulos ( nombre, marca, modelo )
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

    if (estado) query = query.eq('estado', estado);

    if (q) {
        // busqueda por nombre o articulo_id
        query = query.or(`nombre_producto.ilike.%${q}%,articulo_id.ilike.%${q}%`);
    }

    const { data, count, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
        fichas: data,
        total:  count ?? 0,
        page,
        limit,
        pages:  Math.ceil((count ?? 0) / limit),
    });
}

export async function POST(req: NextRequest) {
    const supabase = getSupabase();
    
    try {
        const body = await req.json();
        const { nombre_producto, articulo_id } = body;

        if (!nombre_producto || nombre_producto.trim() === '') {
            return NextResponse.json({ error: 'El nombre del producto es obligatorio' }, { status: 400 });
        }

        const nuevaFicha = {
            estado: 'borrador',
            nombre_producto: nombre_producto.trim(),
            articulo_id: articulo_id || null
        };

        const { data, error } = await supabase
            .from('fichas_tecnicas')
            .insert(nuevaFicha)
            .select('id')
            .single();

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ id: data.id }, { status: 201 });
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Error en la petición' }, { status: 500 });
    }
}
