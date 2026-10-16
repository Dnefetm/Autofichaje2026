// auditoria.ts — Registro best-effort de auditorías (precio + publicación).
//
// Regla de oro: NUNCA lanza error. Si el registro falla (red, BD, migración
// aún no aplicada), se loguea en consola y la acción principal del usuario
// (sincronizar a MeLi, aprobar precio, etc.) sigue su curso sin interrupción.

import { supabaseAdmin } from '@/lib/supabase';

export type AuditoriaAmbito = 'precio' | 'publicacion';

/**
 * Registra una auditoría humana.
 * 1) Actualiza la cabecera (fecha + acción) en publicaciones_externas.
 * 2) Inserta en publicacion_auditoria_log con dedupe por ventana (evita spam
 *    de micro-ediciones: editar 5 campos en 2 min = 1 registro).
 */
export async function registrarAuditoria(
    publicacionId: string,
    ambito: AuditoriaAmbito,
    accion: string,
    detalle: Record<string, any> = {},
    ventanaMin = 5,
): Promise<void> {
    try {
        const fecha = new Date().toISOString();
        const colFecha = ambito === 'precio' ? 'ultima_auditoria_precio_el' : 'ultima_auditoria_pub_el';
        const colAccion = ambito === 'precio' ? 'ultima_auditoria_precio_accion' : 'ultima_auditoria_pub_accion';

        // Cabecera (rápida, para filtrar/ordenar en listas)
        await supabaseAdmin
            .from('publicaciones_externas')
            .update({ [colFecha]: fecha, [colAccion]: accion })
            .eq('id', publicacionId);

        // Bitácora con dedupe por ventana
        const desde = new Date(Date.now() - ventanaMin * 60_000).toISOString();
        const { data: reciente } = await supabaseAdmin
            .from('publicacion_auditoria_log')
            .select('id')
            .eq('publicacion_id', publicacionId)
            .eq('ambito', ambito)
            .eq('accion', accion)
            .gte('created_at', desde)
            .limit(1)
            .maybeSingle();

        if (reciente?.id) return; // ya hay un registro igual reciente

        await supabaseAdmin
            .from('publicacion_auditoria_log')
            .insert({ publicacion_id: publicacionId, ambito, accion, detalle });
    } catch (e) {
        console.error('[auditoria] fallo no crítico (se ignora):', e);
    }
}
