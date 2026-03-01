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
        const current = await redis.get<number>(key) || 0;

        if (current >= limit) {
            logger.warn({ accountId, key }, 'Rate limit alcanzado');
            return false;
        }

        await redis.incr(key);

        // Establecer expiración si es la primera petición en la ventana
        if (current === 0) {
            await redis.expire(key, duration);
        }

        return true;
    } catch (error) {
        logger.error({ error, accountId }, 'Error al verificar rate limit en Redis');
        // Fallback permitiendo la petición si Redis falla (fail-open)
        return true;
    }
}
