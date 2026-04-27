import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface DecisionLinea {
    costo_id: string;
    articulo_id?: string;
    accion: 'confirmar_fuerte' | 'aceptar_cambio_codigo' | 'rechazar' | 'sin_match';
    codigo_nuevo?: string;
}

export async function POST(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const { id } = await props.params;
    const body = await req.json().catch(() => null);
    const acciones: DecisionLinea[] = body?.acciones;

    if (!Array.isArray(acciones)) {
        return NextResponse.json({ ok: false, error: 'Se requiere un array de "acciones".' }, { status: 400 });
    }

    const { data: importacion, error: fetchErr } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, proveedor')
        .eq('id', id)
        .single();

    if (fetchErr || !importacion) {
        return NextResponse.json({ ok: false, error: 'Importacion no encontrada' }, { status: 404 });
    }

    const resultados = { confirmados: 0, huerfanos: 0, cambios_codigo: 0, errores: [] as any[] };

    // Procedimiento Batch simple en TS para garantizar trazabilidad
    // Debido a que "v_proveedores_precios" falló sobre el RPC en despliegues limpiados a 0.
    for (const d of acciones) {
        // 1. Obtener la fila desde costos_articulo
        const { data: costo } = await supabaseAdmin.from('costos_articulo').select('*').eq('id', d.costo_id).single();
        if (!costo) {
            resultados.errores.push({ costo_id: d.costo_id, error: 'Costo no encontrado' });
            continue;
        }

        if (d.accion === 'rechazar') {
            await supabaseAdmin.from('costos_articulo').update({ estado_match: 'rechazado' }).eq('id', d.costo_id);
            continue;
        }

        // Support both articulo_id (from typed interface) and articulo_id_override (from frontend payload)
        const articulo_id = d.articulo_id || (d as any).articulo_id_override || costo.articulo_sugerido_id;

        if (d.accion === 'sin_match' || !articulo_id) {
            // Queda huérfano
            await supabaseAdmin.from('costos_articulo').update({
                estado_match: 'sin_match',
                articulo_id: null,
                vigente: true,
                confirmado_por: 'operador'
            }).eq('id', d.costo_id);
            resultados.huerfanos++;
            continue;
        }

        // Match fuerte o medio -> Hay que verificar si cambió el código si es medio
        if (d.accion === 'aceptar_cambio_codigo' && d.codigo_nuevo) {
            // Registrar en auditoria
            const { data: artResult } = await supabaseAdmin.from('articulos').select('codigo_universal').eq('articulo_id', articulo_id).single();
            await supabaseAdmin.from('auditoria_codigo_universal').insert({
                proveedor: importacion.proveedor,
                codigo_anterior: artResult?.codigo_universal || null,
                codigo_nuevo: d.codigo_nuevo,
                articulo_id: articulo_id
            });
            // Actualizar artículo maestro
            await supabaseAdmin.from('articulos').update({ codigo_universal: d.codigo_nuevo }).eq('articulo_id', articulo_id);
            resultados.cambios_codigo++;
            
            // Actualizar fila iterando a confirmado
            await supabaseAdmin.from('costos_articulo').update({
                estado_match: 'codigo_cambiado',
                articulo_id: articulo_id,
                vigente: true,
                confirmado_por: 'operador'
            }).eq('id', d.costo_id);
            resultados.confirmados++;
        } else {
            // Match fuerte (automático o manual OK sin cambio de código)
            await supabaseAdmin.from('costos_articulo').update({
                estado_match: 'confirmado',
                articulo_id: articulo_id,
                vigente: true,
                confirmado_por: 'operador'
            }).eq('id', d.costo_id);
            resultados.confirmados++;
        }
    }

    // Calcular descontinuados
    // Aquellos artículos del mismo proveedor que están vigentes pero que NO vinieron en esta importación
    // Esto asegura que la limpieza de la lista se mantenga.
    const articulosAprobados = acciones.filter(a => a.articulo_id && a.accion !== 'rechazar').map(a => a.articulo_id);
    if (articulosAprobados.length > 0) {
        // Obtenemos los costos activos de este proveedor que NO están en los articulosAprobados
        const { data: descontinuados } = await supabaseAdmin.from('costos_articulo')
            .select('id')
            .eq('fuente', importacion.proveedor)
            .eq('vigente', true)
            .not('articulo_id', 'in', `(${articulosAprobados.join(',')})`);
            
        if (descontinuados && descontinuados.length > 0) {
            await supabaseAdmin.from('costos_articulo')
                .update({ estado_match: 'descontinuado_por_proveedor', vigente: false })
                .in('id', descontinuados.map(d => d.id));
        }
    }

    // Finalizar lote
    const { count: pendientes } = await supabaseAdmin
        .from('costos_articulo')
        .select('id', { count: 'exact', head: true })
        .eq('importacion_id', id)
        .is('confirmado_por', null); // Requerir explícitamente confirmaciones
        
    if (pendientes === 0) {
        await supabaseAdmin.from('importaciones_excel').update({ estado: 'completado' }).eq('id', id);
    }

    return NextResponse.json({
        ok: true,
        importacion_id: id,
        pendientes_restantes: pendientes || 0,
        ...resultados
    });
}