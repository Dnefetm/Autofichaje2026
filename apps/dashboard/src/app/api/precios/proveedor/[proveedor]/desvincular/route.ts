import { friendlyError } from '@/lib/friendlyError';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(
    req: NextRequest,
    props: { params: Promise<{ proveedor: string }> }
) {
    const { proveedor } = await props.params;
    const body = await req.json().catch(() => null);
    const articulo_id = body?.articulo_id;

    if (!articulo_id) {
        return NextResponse.json({ ok: false, error: 'articulo_id es requerido' }, { status: 400 });
    }

    // 1. Set the matching state to 'sugerido' and remove the articulo_id link in costos_articulo
    // We only update rows that belong to this proveedor. To know the proveedor, we need the importacion_id.
    // Actually, costos_articulo has importacion_id, and importaciones_excel has proveedor.
    
    // First, find all importaciones for this proveedor
    const { data: importaciones } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id')
        .eq('proveedor', decodeURIComponent(proveedor));
        
    if (!importaciones || importaciones.length === 0) {
        return NextResponse.json({ ok: false, error: 'Proveedor no encontrado' }, { status: 404 });
    }
    
    const importacionIds = importaciones.map(i => i.id);

    // Update costos_articulo for this exact articulo_id and importacionIds
    const { error: updateErr } = await supabaseAdmin
        .from('costos_articulo')
        .update({
            articulo_id: null,
            estado_match: 'sugerido',
            confirmado_por: null
        })
        .in('importacion_id', importacionIds)
        .eq('articulo_id', articulo_id);

    if (updateErr) {
        return NextResponse.json({ ok: false, error: friendlyError(updateErr) }, { status: 500 });
    }

    // Update matching_decisiones so that if the user goes back to the import tool, it shows as un-matched.
    const { error: mdErr } = await supabaseAdmin
        .from('matching_decisiones')
        .update({
            confirmado: false,
            articulo_id_final: null,
            confirmado_por: null,
            confirmado_en: null
        })
        .in('importacion_id', importacionIds)
        .eq('articulo_id_final', articulo_id);

    if (mdErr) {
        // Not critical if it fails, but good to know
        console.error("Error updating matching_decisiones on unlink:", mdErr);
    }

    return NextResponse.json({ ok: true });
}
