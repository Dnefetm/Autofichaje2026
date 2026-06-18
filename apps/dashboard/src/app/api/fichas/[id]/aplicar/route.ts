import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

function getSupabaseAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
}

// POST /api/fichas/[id]/aplicar
// Recibe { extraccion_id, campos_aceptados: { campo: valor } }
// Aplica los campos aceptados sobre fichas_tecnicas y marca la extracción como aplicada.
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id: fichaId } = await params;
    if (!fichaId) return NextResponse.json({ error: 'fichaId requerido' }, { status: 400 });

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Body JSON requerido' }, { status: 400 });

    const { extraccion_id, campos_aceptados } = body as {
        extraccion_id?: string;
        campos_aceptados: Record<string, any>;
    };

    if (!campos_aceptados || typeof campos_aceptados !== 'object' || Object.keys(campos_aceptados).length === 0) {
        return NextResponse.json({ error: 'campos_aceptados no puede estar vacío' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Whitelist de campos permitidos
    const CAMPOS_TEXTO = new Set([
        'nombre_producto', 'descripcion', 'descripcion_larga', 'fabricante',
        'especificaciones', 'uso_recomendado', 'precauciones', 'ingredientes',
        'marca', 'modelo', 'variante', 'codigo_universal',
        'categoria', 'materiales', 'pais_origen',
        'informacion_normativa', 'instrucciones_uso',
        'leyendas_precautorias', 'indicaciones_almacenamiento',
    ]);
    const CAMPOS_JSONB = new Set([
        'bullet_points', 'palabras_clave', 'atributos_dinamicos',
        'atributos_categoria', 'atributos_extras',
    ]);
    const CAMPOS_NUM = new Set([
        'peso_kg', 'largo_cm', 'ancho_cm', 'alto_cm'
    ]);

    const update: Record<string, any> = {};
    for (const [campo, valor] of Object.entries(campos_aceptados)) {
        if (CAMPOS_TEXTO.has(campo)) update[campo] = valor ?? null;
        else if (CAMPOS_JSONB.has(campo)) update[campo] = valor;
        else if (CAMPOS_NUM.has(campo)) update[campo] = valor === null || valor === '' ? null : Number(valor) || null;
    }

    if (Object.keys(update).length === 0) {
        return NextResponse.json({ error: 'No hay campos válidos que aplicar' }, { status: 400 });
    }

    // Actualizar fichas_tecnicas
    const { data: ficha, error: updateErr } = await supabase
        .from('fichas_tecnicas')
        .update(update)
        .eq('id', fichaId)
        .select('id, nombre_producto, estado')
        .single();

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    // Marcar extracción como aplicada (si se proporcionó el id)
    if (extraccion_id) {
        await supabase
            .from('ficha_extracciones')
            .update({ aplicada_a_ficha: true })
            .eq('id', extraccion_id)
            .eq('ficha_tecnica_id', fichaId);
    }

    return NextResponse.json({ ok: true, ficha, campos_aplicados: Object.keys(update) });
}
