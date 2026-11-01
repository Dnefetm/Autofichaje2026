import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// POST /api/pricing/edit-draft
// Edita el precio sugerido a mano (spreadsheet style) con paridad en espejo.
export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const { publicacion_id, nuevo_precio } = body;
        const precio = Number(nuevo_precio);

        if (!publicacion_id || !Number.isFinite(precio) || precio <= 0) {
            return NextResponse.json({ error: 'publicacion_id y nuevo_precio (>0) son obligatorios' }, { status: 400 });
        }

        const { error } = await supabaseAdmin.rpc('fn_editar_draft_price', {
            p_publicacion_id: publicacion_id,
            p_nuevo_precio: precio
        });

        if (error) {
            throw error;
        }

        return NextResponse.json({ success: true, publicacion_id, nuevo_precio: precio });
    } catch (err: any) {
        console.error('[POST /api/pricing/edit-draft]', err);
        return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
    }
}
