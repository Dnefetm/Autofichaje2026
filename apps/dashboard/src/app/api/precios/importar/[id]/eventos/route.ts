/**
 * GET /api/precios/importar/[id]/eventos
 *
 * Devuelve el log de eventos (timeline) para una importación específica.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(
    _req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await props.params;

        const { data: eventos, error } = await supabaseAdmin
            .from('importacion_eventos')
            .select('*')
            .eq('importacion_id', id)
            .order('creado_el', { ascending: true });

        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true, eventos });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
