import { Redis } from '@upstash/redis';
import logger from './logger';

// Cliente de Redis para Rate Limiting
let redis: Redis | null = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
}

/**
 * Rate Limiter distribuido usando Token Bucket en Redis
 * @param accountId ID de la cuenta del marketplace
 * @param limit Límite de peticiones permitidas
 * @param duration Ventana de tiempo en segundos
 */
export async function checkRateLimit(accountId: string, limit: number, duration: number): Promise<boolean> {
    if (!redis) return true; // Fail-open si no hay config 

    const key = `ratelimit:${accountId}`;

    try {
        // Pipeline atómico: incr + expire SIEMPRE (no solo cuando current === 0)
        // Esto evita keys huérfanas sin TTL por race conditions
        const pipeline = redis.pipeline();
        pipeline.incr(key);
        pipeline.expire(key, duration);
        const results = await pipeline.exec();

        const count = results[0] as number;

        if (count > limit) {
            logger.warn({ accountId, key, count, limit }, 'Rate limit alcanzado');
            return false;
        }

        return true;
    } catch (error) {
        logger.error({ error, accountId }, 'Error al verificar rate limit en Redis');
        // Fallback permitiendo la petición si Redis falla (fail-open)
        return true;
    }
}
