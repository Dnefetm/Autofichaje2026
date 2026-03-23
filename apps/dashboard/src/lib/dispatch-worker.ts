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
