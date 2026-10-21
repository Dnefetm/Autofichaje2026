import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Whitelist de campos que el enriquecimiento web puede escribir sobre articulos.
const CAMPOS_PERMITIDOS = new Set(['descripcion', 'url_imagen', 'imagenes', 'url_producto']);

/**
 * POST /api/articulos/[id]/enriquecer-aplicar
 * Body: { campos: { descripcion?, url_imagen?, imagenes?, url_producto? } }
 * Aplica SOLO los campos ya revisados y aceptados por el operario. Determinista: no re-scrapea.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: articuloId } = await params;
    if (!articuloId) return NextResponse.json({ error: 'articulo_id requerido' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const campos = body?.campos as Record<string, any> | undefined;
    if (!campos || typeof campos !== 'object' || Object.keys(campos).length === 0) {
        return NextResponse.json({ error: 'campos no puede estar vacío' }, { status: 400 });
    }

    const update: Record<string, any> = {};
    for (const [campo, valor] of Object.entries(campos)) {
        if (!CAMPOS_PERMITIDOS.has(campo)) continue;
        if (campo === 'imagenes') {
            update[campo] = Array.isArray(valor) ? valor.map((u) => String(u)).filter(Boolean) : [];
        } else {
            update[campo] = valor === null || valor === undefined || valor === '' ? null : String(valor);
        }
    }

    if (Object.keys(update).length === 0) {
        return NextResponse.json({ error: 'No hay campos válidos que aplicar' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('articulos').update(update).eq('articulo_id', articuloId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, campos_aplicados: Object.keys(update) });
}
