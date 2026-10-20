import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/pipeline/salud — conteos del pipeline de precios (server-side).
// Reemplaza la consulta directa desde el cliente (anon) en /pipeline.
// Usa service_role, inmune al cierre de RLS para anon.
export async function GET() {
    const conteo = async (tabla: string, filtro?: string) => {
        try {
            let q = supabaseAdmin.from(tabla).select('*', { count: 'exact', head: true });
            if (filtro === 'completado') q = q.eq('estado', 'completado');
            if (filtro === 'vigente') q = q.eq('vigente', true);
            const { count, error } = await q;
            if (error) return -1;
            return count ?? 0;
        } catch {
            return -1;
        }
    };

    const etapas = [
        { orden: 1, nombre: 'Listas crudas (raw)', descripcion: 'listas_precios_raw', critica: false, n: await conteo('listas_precios_raw') },
        { orden: 2, nombre: 'Precios proveedor actual', descripcion: 'precios_proveedor_actual', critica: false, n: await conteo('precios_proveedor_actual') },
        { orden: 3, nombre: 'Importaciones completadas', descripcion: 'importaciones_excel (estado=completado)', critica: false, n: await conteo('importaciones_excel', 'completado') },
        { orden: 4, nombre: 'Jobs de matching', descripcion: 'matching_jobs', critica: false, n: await conteo('matching_jobs') },
        { orden: 5, nombre: 'Decisiones de matching', descripcion: 'matching_decisiones', critica: false, n: await conteo('matching_decisiones') },
        { orden: 6, nombre: 'Costos pendientes (staging)', descripcion: 'costos_pendientes', critica: false, n: await conteo('costos_pendientes') },
        { orden: 7, nombre: 'Costos articulo (resueltos)', descripcion: 'costos_articulo', critica: true, n: await conteo('costos_articulo') },
        { orden: 8, nombre: 'Listas vigentes', descripcion: 'listas_precios_proveedor (vigente=true)', critica: true, n: await conteo('listas_precios_proveedor', 'vigente') },
        { orden: 9, nombre: 'Precio vigente por SKU', descripcion: 'v_precio_vigente_sku (vista)', critica: true, n: await conteo('v_precio_vigente_sku') },
        { orden: 10, nombre: 'Precios publicados', descripcion: 'precios_publicados', critica: false, n: await conteo('precios_publicados') },
    ];

    return NextResponse.json({ etapas });
}
