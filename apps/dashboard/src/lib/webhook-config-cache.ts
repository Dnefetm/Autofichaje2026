import { supabaseAdmin } from './supabase';

/**
 * Caché en memoria para webhook_config.
 *
 * Cada invocación del webhook hacía un SELECT a webhook_config (~50ms).
 * Con ~7K webhooks/12h, eso son ~7K queries/12h solo para leer una config
 * que cambia quizás 1 vez al mes.
 *
 * En Vercel Fluid Compute, la instancia lambda se reutiliza entre requests,
 * así que este Map persiste entre invocaciones del mismo lambda.
 * TTL de 5 minutos: si el usuario cambia la config, tarda máximo 5 min en reflejarse.
 */

interface CacheEntry {
    data: {
        window_seconds: number;
        dispatch_immediate: boolean;
        enabled: boolean;
        priority: number;
    } | null;
    expiresAt: number;
}

const CONFIG_CACHE = new Map<string, CacheEntry>();
const CONFIG_TTL_MS = 5 * 60 * 1000; // 5 minutos

export async function getWebhookConfigCached(topic: string): Promise<CacheEntry['data']> {
    const cached = CONFIG_CACHE.get(topic);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
    }

    // Desactivado temporalmente para evitar 400 Bad Request recurrentes 
    // en PostgREST (143/h) porque la tabla/columnas webhook_config no existen o fallan.
    // El sistema usará los TOPIC_DEFAULTS en route.ts de forma segura.
    /*
    const { data } = await supabaseAdmin
        .from('webhook_config')
        .select('window_seconds, dispatch_immediate, enabled, priority')
        .eq('topic', topic)
        .maybeSingle();
    */
    const data = null;

    CONFIG_CACHE.set(topic, {
        data,
        expiresAt: Date.now() + CONFIG_TTL_MS,
    });

    return data;
}
