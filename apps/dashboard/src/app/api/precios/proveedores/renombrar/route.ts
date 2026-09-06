import { friendlyError } from '@/lib/friendlyError';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Renombra un proveedor en TODAS las tablas (fn_renombrar_proveedor es transaccional).
export async function POST(req: Request) {
    const body = await req.json().catch(() => ({}));
    const viejo = (body?.viejo ?? '').toString().trim();
    const nuevo = (body?.nuevo ?? '').toString().trim();

    if (!viejo || !nuevo) {
        return NextResponse.json({ error: 'Nombre actual y nuevo son requeridos' }, { status: 400 });
    }
    if (viejo === nuevo) {
        return NextResponse.json({ ok: true });
    }

    const { error } = await supabaseAdmin.rpc('fn_renombrar_proveedor', {
        p_viejo: viejo,
        p_nuevo: nuevo,
    });
    if (error) {
        return NextResponse.json({ error: friendlyError(error) }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
}
