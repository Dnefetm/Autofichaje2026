import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * POST /api/catalog/external/[id]/sync-enable
 * Limpia la bandera de sync_disabled y su razón para reactivar la sincronización.
 */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    try {
        const { error } = await supabaseAdmin
            .from('publicaciones_externas')
            .update({
                sync_disabled: false,
                sync_disabled_reason: null,
                actualizado_el: new Date().toISOString(),
            })
            .eq('id', id);

        if (error) throw error;

        return NextResponse.json({ ok: true, message: 'Sincronización reactivada con éxito' });
    } catch (err: any) {
        console.error('[POST /api/catalog/external/[id]/sync-enable]', err);
        return NextResponse.json({ ok: false, error: err.message || 'Error al reactivar sincronización' }, { status: 500 });
    }
}
