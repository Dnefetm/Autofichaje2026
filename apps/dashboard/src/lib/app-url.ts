function cleanUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Resuelve la URL interna para auto-despacho del worker (/api/worker/process).
 * Prioridad (H1/H2):
 *  1. INTERNAL_APP_URL (VPS/Docker/Coolify, ej. http://127.0.0.1:3000)
 *  2. VERCEL_URL (Vercel hoy — comportamiento 100% idéntico a producción actual)
 *  3. Fallback local respetando PORT (ej. http://localhost:3000)
 */
export function getInternalAppUrl(): string {
  const internal = process.env.INTERNAL_APP_URL;
  if (internal && internal.trim().length > 0) {
    return cleanUrl(internal);
  }
  const vercel = process.env.VERCEL_URL;
  if (vercel && vercel.trim().length > 0) {
    const normalized = vercel.trim().replace(/^https?:\/\//, '');
    return cleanUrl(`https://${normalized}`);
  }
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}
