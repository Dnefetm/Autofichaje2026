import { supabaseAdmin } from './supabase';

/**
 * Fire-and-forget dispatch al worker endpoint.
 * Llama a /api/worker/process inmediatamente despues de insertar un job,
 * eliminando la necesidad de polling cada 1 minuto.
 * 
 * Si falla (timeout, red, etc.), el cron safety-net (cada 5 min) lo recogera.
 * NO bloquea la respuesta al usuario — usa AbortController con timeout corto.
 */
export async function dispatchWorker(): Promise<void> {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        console.warn('[dispatchWorker] CRON_SECRET no configurado — el cron safety-net procesara el job');
        return;
    }

    try {
        const now = new Date();
        const tenSecondsAgo = new Date(now.getTime() - 10000).toISOString();

        // 1. Intentar actualizar si ya pasaron 10 segundos
        const { data: updated } = await supabaseAdmin
            .from('webhook_config')
            .update({ updated_at: now.toISOString() })
            .eq('topic', 'worker_dispatch_lock')
            .lt('updated_at', tenSecondsAgo)
            .select('topic');

        // Si no se actualizó nada, significa que alguien más lo hizo hace menos de 10s o la fila no existe.
        if (!updated || updated.length === 0) {
            // Verificamos si no existe
            const { data: existing } = await supabaseAdmin
                .from('webhook_config')
                .select('topic')
                .eq('topic', 'worker_dispatch_lock')
                .maybeSingle();
                
            if (!existing) {
                // Si no existe, intentamos insertarla. Si choca, otro lambda la insertó (race condition), lo cual es seguro ignorar
                const { error: insertErr } = await supabaseAdmin.from('webhook_config').insert({
                    topic: 'worker_dispatch_lock',
                    updated_at: now.toISOString()
                });
                if (insertErr) return; // Alguien ganó el lock
            } else {
                return; // Alguien ganó el lock y está en cooldown
            }
        }
    } catch (e) {
        // Ignorar
    }

    // Construir URL base: VERCEL_URL en produccion, localhost en dev
    const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';

    // Fire-and-forget: no esperamos respuesta, timeout agresivo de 2s
    // Si el worker tarda mas, seguira ejecutandose en background (Vercel lo mantiene hasta maxDuration)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    try {
        fetch(`${baseUrl}/api/worker/process`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${secret}` },
            signal: controller.signal,
        }).catch(() => {
            // Silenciar errores — el cron safety-net se encarga
        });
    } catch {
        // Silenciar — fire-and-forget
    } finally {
        clearTimeout(timeout);
    }
}
