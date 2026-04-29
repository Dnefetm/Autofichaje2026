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
        // GLOBAL DEBOUNCE: Solo permitir un trigger cada 10 segundos para evitar amplificación masiva de workers
        const { data: lock } = await supabaseAdmin
            .from('webhook_config')
            .select('updated_at')
            .eq('topic', 'worker_dispatch_lock')
            .maybeSingle();

        if (lock?.updated_at) {
            const msSinceLast = Date.now() - new Date(lock.updated_at).getTime();
            if (msSinceLast < 10000) {
                // Ya hay un worker en camino o procesando. Él recogerá este job.
                return;
            }
        }

        await supabaseAdmin.from('webhook_config').upsert({
            topic: 'worker_dispatch_lock',
            updated_at: new Date().toISOString()
        }, { onConflict: 'topic' });
    } catch (e) {
        // Si el lock falla, continuamos para no romper la funcionalidad
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
