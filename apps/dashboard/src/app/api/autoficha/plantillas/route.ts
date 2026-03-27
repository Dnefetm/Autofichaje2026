import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// GET /api/autoficha/plantillas?categoria=Herramientas+Manuales
// GET /api/autoficha/plantillas  → lista todas las activas

export const runtime = 'nodejs';

function getSupabase() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const categoria = searchParams.get('categoria') || '';
    const supabase  = getSupabase();

    try {
        if (categoria) {
            // Consulta plantilla específica
            const { data, error } = await supabase
                .from('categoria_plantillas')
                .select('categoria, nombre_display, campos')
                .eq('categoria', categoria)
                .single();

            if (error || !data) {
                // Si no hay plantilla para esta categoría, retornar obj vacío (no es error)
                return NextResponse.json({ categoria, campos: [], nombre_display: categoria });
            }
            return NextResponse.json(data);
        }

        // Listar todas las plantillas activas
        const { data, error } = await supabase
            .from('categoria_plantillas')
            .select('categoria, nombre_display, campos')
            .eq('activo', true)
            .order('nombre_display');

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ plantillas: data ?? [] });

    } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'Error interno' }, { status: 500 });
    }
}
