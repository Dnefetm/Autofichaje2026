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
        // Ventana fija ATOMICA (Lua): INCR + EXPIRE solo en el PRIMER incremento.
        // Antes se hacía `incr` + `expire` en CADA llamada, lo que reiniciaba el TTL
        // en cada request y el contador nunca expiraba durante ráfagas (bug → bloqueo permanente).
        const SCRIPT = `
          local c = redis.call('INCR', KEYS[1])
          if c == 1 then
            redis.call('EXPIRE', KEYS[1], ARGV[1])
          end
          return c
        `;
        const count = (await redis.eval(SCRIPT, [key], [String(duration)])) as number;

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
