import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { registrarAuditoria } from '@/lib/auditoria';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { publicaciones } = body;

        if (!Array.isArray(publicaciones) || publicaciones.length === 0) {
            return NextResponse.json({ error: 'Faltan publicaciones para aprobar' }, { status: 400 });
        }

        const { error } = await supabaseAdmin.rpc('fn_aprobar_precios_draft', {
            p_publicaciones: publicaciones
        });

        if (error) {
            throw error;
        }

        for (const pid of publicaciones) {
            await registrarAuditoria(pid, 'precio', 'aprobacion_borrador');
        }

        return NextResponse.json({ success: true, message: ` publicaciones aprobadas y encoladas para sincronización.` });
    } catch (err: any) {
        console.error('[POST /api/pricing/approve-drafts]', err);
        return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
    }
}

