import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

// Service role para bypassear RLS en operaciones destructivas
function getSupabaseAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
}

// GET /api/fichas/[id]  — detalle completo (opcional, por si se necesita en el futuro)
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
        .from('fichas_tecnicas')
        .select('id, estado, nombre_producto, descripcion, articulo_id, created_at')
        .eq('id', id)
        .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data)  return NextResponse.json({ error: 'Ficha no encontrada' }, { status: 404 });
    return NextResponse.json({ ficha: data });
}

// DELETE /api/fichas/[id]
// Restringe eliminación a fichas en estado 'borrador'.
// Elimina en cascada: ficha_extracciones (registros hijo) → fichas_tecnicas.
export async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

    const supabase = getSupabaseAdmin();

    // Verificar que existe y obtener estado
    const { data: ficha, error: fetchError } = await supabase
        .from('fichas_tecnicas')
        .select('id, estado, articulo_id')
        .eq('id', id)
        .single();

    if (fetchError || !ficha) {
        return NextResponse.json({ error: 'Ficha no encontrada' }, { status: 404 });
    }

    if (ficha.estado === 'publicada') {
        return NextResponse.json(
            { error: 'No se puede eliminar una ficha publicada. Cámbiala a borrador primero.' },
            { status: 422 }
        );
    }

    // Eliminar registros hijo en ficha_extracciones (si existen)
    const { error: extError } = await supabase
        .from('ficha_extracciones')
        .delete()
        .eq('ficha_id', id);

    if (extError) {
        // No tratar como error fatal — podría no tener extracciones
        console.warn('[DELETE ficha] error al eliminar extracciones:', extError.message);
    }

    // Eliminar la ficha
    const { error } = await supabase
        .from('fichas_tecnicas')
        .delete()
        .eq('id', id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, id });
}
