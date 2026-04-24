import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    // Seguridad: Vercel inyecta CRON_SECRET en el header de autorización cuando invoca el cron
    const authHeader = request.headers.get('authorization');
    const isCronRequest = authHeader === `Bearer ${process.env.CRON_SECRET}`;

    // Permitimos llamadas sin token solo en entorno local de desarrollo para pruebas
    if (!isCronRequest && process.env.NODE_ENV !== 'development') {
        return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });
    }

    try {
        // 1. Verificar si hay algún trabajo pendiente en la base de datos
        const { data: pendingJobs, error: fetchErr } = await supabaseAdmin
            .from('matching_jobs')
            .select('id')
            .eq('estado', 'pendiente')
            .limit(1);

        if (fetchErr) {
            console.error("Error al buscar trabajos pendientes:", fetchErr);
            return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
        }

        if (!pendingJobs || pendingJobs.length === 0) {
            // No hay nada que hacer, terminamos en paz
            return NextResponse.json({ ok: true, mensaje: 'No hay trabajos pendientes.' }, { status: 200 });
        }

        // 2. Si hay al menos un trabajo pendiente, despertamos al worker (Edge Function)
        // La Edge Function usa FOR UPDATE SKIP LOCKED internamente para tomar UN trabajo
        const runRes = await supabaseAdmin.functions.invoke('procesar-matching', {
            body: {} // No enviamos ID específico; el worker hace POP a la cola por sí mismo.
        });

        if (runRes.error) {
            console.error("Error al invocar procesar-matching:", runRes.error);
            return NextResponse.json({ ok: false, error: 'Error al invocar worker' }, { status: 500 });
        }

        return NextResponse.json({ ok: true, mensaje: 'Worker despachado exitosamente.' }, { status: 200 });

    } catch (error: any) {
        console.error("Excepción en cron dispatch-matching:", error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
