import { friendlyError } from '@/lib/friendlyError';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST /api/precios/importar/[id]/procesar
// Mundo 1: procesa los precios del proveedor de forma autónoma (sin matching ni catálogo)
// y deja la importación en 'en_revision' con el resumen del diff.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const { id } = await props.params;

    try {
        const { data: resumen, error: procErr } = await supabaseAdmin.rpc('fn_procesar_precios_proveedor', {
            p_importacion_id: id
        });
        if (procErr) throw new Error(procErr.message);

        await supabaseAdmin.from('importaciones_excel').update({
            resumen_diff: {
                nuevos: resumen?.nuevos ?? 0,
                actualizados: resumen?.actualizados ?? 0,
                sin_cambio: resumen?.sin_cambio ?? 0,
                descontinuados: resumen?.descontinuados ?? 0,
            },
            estado: 'en_revision',
            ultima_actividad: new Date().toISOString()
        }).eq('id', id);

        return NextResponse.json({ ok: true, resumen });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: friendlyError(e) }, { status: 500 });
    }
}
