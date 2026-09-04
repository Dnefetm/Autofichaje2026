import { supabaseAdmin } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Extend duration for large batches

// H9 (POLITICAS_FRONTEND.md): nunca exponer errores crudos de Postgres/Supabase.
const friendlyError = (e: any) => {
    const code = e?.code;
    if (code === '23503') return 'El artículo seleccionado ya no existe en el catálogo.';
    if (code === '23505') return 'Este SKU ya tiene un vínculo registrado.';
    if (code === '22P02') return 'Formato de dato inválido en la vinculación.';
    if (code === '23502') return 'Falta un dato obligatorio para vincular (código o marca+modelo).';
    return 'No se pudo completar la vinculación. Inténtalo de nuevo.';
};

export async function POST(
    req: NextRequest,
    props: { params: Promise<{ proveedor: string }> }
) {
    const { proveedor } = await props.params;
    const body = await req.json();
    const { items, importacion_id }: {
        items: Array<{
            codigo_excel: string;
            modelo_excel: string;
            marca_excel: string;
            articulo_id: string;
        }>;
        importacion_id?: string;
    } = body;

    if (!items || items.length === 0) {
        return NextResponse.json({ ok: false, error: 'No hay items' }, { status: 400 });
    }

    const proveedorDecoded = decodeURIComponent(proveedor);

    const { error } = await supabaseAdmin.rpc('fn_vincular_lote', {
        p_proveedor: proveedorDecoded,
        p_items: items
    });

    if (error) {
        console.error('Error in fn_vincular_lote:', error);
        return NextResponse.json({ ok: false, error: friendlyError(error) }, { status: 500 });
    }

    // Re-materializar la clasificación del lote para que la tabla paginada refleje
    // los nuevos alias locked (los items recién vinculados pasan a "ya_vinculado").
    if (importacion_id) {
        const { error: matErr } = await supabaseAdmin.rpc('fn_materializar_vinculacion', {
            p_importacion_id: importacion_id,
            p_proveedor: proveedorDecoded,
        });
        if (matErr) {
            console.error('Error re-materializando vinculación:', matErr);
            // No falla la vinculación: el alias ya quedó guardado. La próxima visita
            // materializará de nuevo. Avisamos igualmente para no romper el flujo.
        }
    }

    revalidatePath('/precios', 'layout');
    return NextResponse.json({ ok: true, insertados: items.length });
}

