// Simple logger wrapper compatible with pino API
export const logger = {
    info: (obj: Record<string, any>, msg?: string) => {
        console.log(`[INFO] ${msg || ''}`, obj);
    },
    error: (obj: Record<string, any>, msg?: string) => {
        console.error(`[ERROR] ${msg || ''}`, obj);
    },
    warn: (obj: Record<string, any>, msg?: string) => {
        console.warn(`[WARN] ${msg || ''}`, obj);
    },
    debug: (obj: Record<string, any>, msg?: string) => {
        console.debug(`[DEBUG] ${msg || ''}`, obj);
    },
};
