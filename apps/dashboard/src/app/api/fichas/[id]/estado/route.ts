import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

function getSupabaseAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id: fichaId } = await params;
    const supabase = getSupabaseAdmin();
    
    try {
        const body = await req.json();
        const { estado } = body;

        if (!['borrador', 'revision', 'publicado'].includes(estado)) {
            return NextResponse.json({ error: 'Estado inválido' }, { status: 400 });
        }

        // Si se pasa a revisión o publicado, validar completitud básica
        if (estado === 'revision' || estado === 'publicado') {
            const { data: ficha, error: fichaErr } = await supabase
                .from('fichas_tecnicas')
                .select(`
                    id, 
                    descripcion, 
                    codigo_universal, 
                    articulo_id,
                    articulos ( descripcion, codigo_universal )
                `)
                .eq('id', fichaId)
                .single();

            if (fichaErr || !ficha) {
                return NextResponse.json({ error: 'Ficha no encontrada' }, { status: 404 });
            }

            // Validar que tenga descripción
            const desc = ficha.descripcion || (ficha.articulos as any)?.descripcion;
            if (!desc || desc.trim() === '') {
                return NextResponse.json({ error: 'Falta la descripción corta. Es obligatoria para avanzar.' }, { status: 400 });
            }

            // Validar que tenga EAN
            const ean = ficha.codigo_universal || (ficha.articulos as any)?.codigo_universal;
            if (!ean || ean.trim() === '') {
                return NextResponse.json({ error: 'Falta el Código de barras (EAN). Es obligatorio para avanzar.' }, { status: 400 });
            }

            // Validar que tenga al menos una imagen
            const { count, error: imgErr } = await supabase
                .from('ficha_imagenes')
                .select('*', { count: 'exact', head: true })
                .eq('ficha_id', fichaId);
                
            if (imgErr || count === 0) {
                return NextResponse.json({ error: 'Debes subir al menos una imagen antes de avanzar el estado.' }, { status: 400 });
            }
        }

        // Actualizar el estado
        // NOTA: Por ahora no validamos el rol del usuario, tal cual solicitó el usuario.
        // Se podrían añadir campos como revisado_por, revisado_at, etc. en el futuro.
        const { error: updateErr } = await supabase
            .from('fichas_tecnicas')
            .update({ estado })
            .eq('id', fichaId);

        if (updateErr) {
            return NextResponse.json({ error: updateErr.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true, estado });
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Error en la petición' }, { status: 500 });
    }
}
