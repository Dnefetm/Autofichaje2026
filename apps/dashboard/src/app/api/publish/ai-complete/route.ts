import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { generateListingContent } from '@gestor/sync/listing-ai';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    const articulo_id = body?.articulo_id;
    if (!articulo_id) {
        return NextResponse.json({ ok: false, error: 'articulo_id requerido' }, { status: 400 });
    }

    // Artículo
    const { data: articulo, error: artErr } = await supabaseAdmin
        .from('articulos')
        .select('*')
        .eq('articulo_id', articulo_id)
        .single();
    if (artErr || !articulo) {
        return NextResponse.json({ ok: false, error: 'Artículo no encontrado' }, { status: 404 });
    }

    // Ficha técnica más reciente (opcional, prioridad sobre artículo)
    const { data: fichas } = await supabaseAdmin
        .from('fichas_tecnicas')
        .select('*')
        .eq('articulo_id', articulo_id)
        .order('created_at', { ascending: false })
        .limit(1);
    const ficha = fichas?.[0] || null;

    const merged = {
        nombre: ficha?.nombre_producto || articulo.nombre || '',
        marca: ficha?.marca || articulo.marca || '',
        modelo: ficha?.modelo || articulo.modelo || '',
        variante: ficha?.variante || articulo.variante || '',
        categoria: ficha?.categoria || articulo.categoria || '',
        descripcion: ficha?.descripcion_larga || ficha?.descripcion || articulo.descripcion || '',
        atributos_especificos: articulo.atributos_especificos || {},
        bullet_points: ficha?.bullet_points || [],
        palabras_clave: ficha?.palabras_clave || [],
        materiales: ficha?.materiales || articulo.materiales || '',
        peso_kg: ficha?.peso_kg ?? articulo.peso_kg,
        largo_cm: ficha?.largo_cm ?? articulo.largo_cm,
        ancho_cm: ficha?.ancho_cm ?? articulo.ancho_cm,
        alto_cm: ficha?.alto_cm ?? articulo.alto_cm,
        pais_origen: ficha?.pais_origen || articulo.pais_origen || '',
        codigo_universal: ficha?.codigo_universal || articulo.codigo_universal || '',
    };

    const result = await generateListingContent(merged);
    return NextResponse.json({ ok: true, ...result });
}
