import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// GET /api/articulos/[id]
// Devuelve un artículo por articulo_id usando service role key (sin RLS).
// Usado por /autoficha?articulo_id=X para pre-vincular desde el catálogo.

export const runtime = 'nodejs';

function getSupabaseAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        // Service role bypasea RLS en tablas protegidas (articulos).
        // Si SUPABASE_SERVICE_ROLE_KEY no está configurado, cae al anon key como fallback.
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
}

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    if (!id?.trim()) {
        return NextResponse.json({ error: 'articulo_id requerido' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
        .from('articulos')
        .select(`
            articulo_id, nombre, marca, modelo, variante, categoria,
            descripcion, codigo_universal, codigo_sat,
            peso_kg, largo_cm, ancho_cm, alto_cm, materiales, pais_origen
        `)
        .eq('articulo_id', id.trim())
        .single();

    if (error) {
        // PGRST116 = no rows → artículo no existe
        if (error.code === 'PGRST116') {
            return NextResponse.json({ error: `Artículo "${id}" no encontrado en el catálogo.` }, { status: 404 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
        return NextResponse.json({ error: `Artículo "${id}" no encontrado en el catálogo.` }, { status: 404 });
    }

    return NextResponse.json({ articulo: data });
}
