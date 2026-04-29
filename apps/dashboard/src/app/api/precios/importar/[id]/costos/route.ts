/**
 * GET /api/precios/importar/[id]/costos
 *
 * Devuelve los costos generados para una importación específica,
 * consultando v_costos_pendientes para la revisión humana.
 *
 * Query params opcionales:
 *  - estado: sin_match | sugerido | todos (default: todos los pendientes)
 *  - limit: number (default 200)
 *  - offset: number (default 0)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const { id } = await props.params;
    const { searchParams } = req.nextUrl;
    const estadoFiltro = searchParams.get('estado') || 'todos';
    const limit  = Math.min(parseInt(searchParams.get('limit') || '200', 10), 500);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // ── Verificar que la importación existe ──────────────────────────────────
    const { data: importacion, error: fetchErr } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, nombre_archivo, proveedor, total_filas, filas_con_match, estado, tipo_costo_default')
        .eq('id', id)
        .single();

    if (fetchErr || !importacion) {
        return NextResponse.json(
            { ok: false, error: 'Importación no encontrada' },
            { status: 404 }
        );
    }

    // ── Consultar costos con campos del Excel ──────────────────────────────
    let query = supabaseAdmin
        .from('costos_articulo')
        .select(`
            id,
            articulo_id,
            articulo_sugerido_id,
            modelo_excel,
            marca_excel,
            codigo_universal_excel,
            descripcion_excel,
            tipo_costo,
            valor,
            moneda,
            fuente,
            puntaje_match,
            estado_match,
            confirmado_por,
            creado_el,
            candidatos_jsonb
        `)
        .eq('importacion_id', id)
        .order('puntaje_match', { ascending: false, nullsFirst: false })
        .order('creado_el', { ascending: false })
        .range(offset, offset + limit - 1);

    const q = searchParams.get('q') || '';

    if (estadoFiltro !== 'todos') {
        // Map old frontend filters to new DB values
        if (estadoFiltro === 'sugerido') {
             query = query.in('estado_match', ['match_exacto', 'match_similitud']);
        } else {
             query = query.eq('estado_match', estadoFiltro);
        }
    } else {
        query = query.in('estado_match', ['sin_match', 'match_exacto', 'match_similitud', 'sugerido']);
    }

    if (q) {
        const ilikeQ = `%${q}%`;
        query = query.or(`modelo_excel.ilike.${ilikeQ},marca_excel.ilike.${ilikeQ},codigo_universal_excel.ilike.${ilikeQ},descripcion_excel.ilike.${ilikeQ}`);
    }

    const { data: costos, error: costosErr } = await query;

    if (costosErr) {
        return NextResponse.json(
            { ok: false, error: `Error al consultar costos: ${costosErr.message}` },
            { status: 500 }
        );
    }

    // ── Enriquecer con datos del artículo sugerido y candidatos (incluyendo caja_madre) ──
    const articuloIdsSet = new Set<string>();
    (costos ?? []).forEach(c => {
        if (c.articulo_sugerido_id) articuloIdsSet.add(c.articulo_sugerido_id);
        if (Array.isArray(c.candidatos_jsonb)) {
            c.candidatos_jsonb.forEach((cand: any) => {
                if (cand.articulo_id) articuloIdsSet.add(cand.articulo_id);
            });
        }
    });
    const articuloIds = Array.from(articuloIdsSet);

    let articulosMap: Record<string, any> = {};
    if (articuloIds.length > 0) {
        const { data: arts } = await supabaseAdmin
            .from('articulos')
            .select('articulo_id, nombre, marca, modelo, codigo_universal, caja_madre')
            .in('articulo_id', articuloIds);

        articulosMap = Object.fromEntries((arts ?? []).map((a) => [a.articulo_id, a]));
    }

    const costosEnriquecidos = (costos ?? []).map((c) => {
        let candidatos = Array.isArray(c.candidatos_jsonb) ? c.candidatos_jsonb : [];
        if (candidatos.length === 0 && c.articulo_sugerido_id) {
           // Sintetizar candidato a partir de articulo_sugerido_id
           candidatos = [{
              articulo_id: c.articulo_sugerido_id,
              puntaje_match: c.puntaje_match || 100,
              metodo_match: 'sistema'
           }];
        }

        return {
            ...c,
            articulo_sugerido: c.articulo_sugerido_id
                ? articulosMap[c.articulo_sugerido_id] ?? null
                : null,
            candidatos_jsonb: candidatos.map((cand: any) => ({
                ...cand,
                nombre: articulosMap[cand.articulo_id]?.nombre ?? cand.nombre ?? null,
                marca: articulosMap[cand.articulo_id]?.marca ?? null,
                modelo: articulosMap[cand.articulo_id]?.modelo ?? null,
                codigo_universal: articulosMap[cand.articulo_id]?.codigo_universal ?? null,
                caja_madre: articulosMap[cand.articulo_id]?.caja_madre ?? null
            }))
        };
    });

    // ── Fetch matching_decisiones IDs for the groups ──────────────────────────
    const { data: decisionesData } = await supabaseAdmin
        .from('matching_decisiones')
        .select('id, codigo_universal_excel, marca_excel, modelo_excel')
        .eq('importacion_id', id);

    const decisionesMap = new Map<string, string>();
    (decisionesData || []).forEach(d => {
        const key = `${d.modelo_excel || ''}||${d.marca_excel || ''}||${d.codigo_universal_excel || ''}`;
        decisionesMap.set(key, d.id);
    });

    // ── Grouping ──────────────────────────────────────────
    const gruposMap = new Map<string, any>();
    const candidatosTopSet = new Set<string>();

    costosEnriquecidos.forEach((c) => {
        const clave = `${c.modelo_excel || ''}||${c.marca_excel || ''}||${c.codigo_universal_excel || ''}`;
        
        if (!gruposMap.has(clave)) {
            gruposMap.set(clave, {
                clave,
                excel: {
                    modelo: c.modelo_excel || '',
                    marca: c.marca_excel || '',
                    codigo_universal: c.codigo_universal_excel || null,
                    descripcion: c.descripcion_excel || null,
                },
                catalogo_sugerido: (c.candidatos_jsonb && c.candidatos_jsonb.length > 0) ? c.candidatos_jsonb[0] : null,
                candidatos_jsonb: c.candidatos_jsonb || [],
                precios_nuevos: {},
                precios_anteriores: {},
                estado_grupo: c.estado_match,
                articulo_id_final: c.articulo_id || null,
                matching_decision_id: decisionesMap.get(clave) || null,
            });
        }
        
        const grupo = gruposMap.get(clave);
        // If one of them has the final ID, ensure the group has it.
        if (c.articulo_id && !grupo.articulo_id_final) {
             grupo.articulo_id_final = c.articulo_id;
        }
        grupo.precios_nuevos[c.tipo_costo] = {
            costo_id: c.id,
            valor: c.valor,
            moneda: c.moneda,
            tipo_costo: c.tipo_costo
        };
        
        if (grupo.catalogo_sugerido?.articulo_id) {
            candidatosTopSet.add(grupo.catalogo_sugerido.articulo_id);
        }
    });

    // ── Fetch precios_anteriores from lista_precios_proveedor (Fase 0) ──────────────────────────
    let preciosAnterioresRaw: any[] = [];
    const { data: paData } = await supabaseAdmin
        .from('lista_precios_proveedor')
        .select('codigo_excel, marca_excel, modelo_excel, precio_distrib, precio_subdistrib, precio_menudeo, precio_mayoreo')
        .eq('proveedor', imp.proveedor)
        .eq('vigente', false)
        .order('vigente_desde', { ascending: false });
        
    preciosAnterioresRaw = paData || [];
    
    const preciosAnterioresPorFila: Record<string, any> = {};
    for (const row of preciosAnterioresRaw) {
        const key = `${row.codigo_excel || ''}_${row.marca_excel || ''}_${row.modelo_excel || ''}`;
        if (!preciosAnterioresPorFila[key]) {
            preciosAnterioresPorFila[key] = {
                ...(row.precio_distrib ? { distribuidor: { valor: row.precio_distrib, moneda: 'MXN' } } : {}),
                ...(row.precio_subdistrib ? { subdistribuidor: { valor: row.precio_subdistrib, moneda: 'MXN' } } : {}),
                ...(row.precio_menudeo ? { menudeo: { valor: row.precio_menudeo, moneda: 'MXN' } } : {}),
                ...(row.precio_mayoreo ? { mayoreo: { valor: row.precio_mayoreo, moneda: 'MXN' } } : {})
            };
        }
    }

    function clasificarEstadoInternal(puntaje: number | null) {
        if (puntaje === null) return 'sin_match';
        if (puntaje === 100) return 'match_exacto';
        if (puntaje >= 40 && puntaje < 100) return 'match_similitud';
        return 'sin_match';
    }

    const grupos = Array.from(gruposMap.values()).map(g => {
        const key = `${g.excel.codigo_universal || ''}_${g.excel.marca || ''}_${g.excel.modelo || ''}`;
        g.precios_anteriores = preciosAnterioresPorFila[key] || {};
        
        // Fix del estado_grupo: tomar MAX(puntaje_match) de los candidatos
        let maxScore: number | null = null;
        if (g.candidatos_jsonb && g.candidatos_jsonb.length > 0) {
           maxScore = Math.max(...g.candidatos_jsonb.map((c: any) => c.puntaje_match));
        }
        g.estado_grupo = clasificarEstadoInternal(maxScore);
        
        return g;
    });

    // ── Conteo general de estados (Optimizando con RPC) ──
    const { data: rpcStats } = await supabaseAdmin.rpc('fn_resumen_matching', { p_importacion_id: id });
    const stats = rpcStats || {
        sin_match: 0,
        sugerido: 0,
        confirmado: 0,
        rechazado: 0,
    };

    return NextResponse.json({
        ok: true,
        importacion,
        grupos,
        total_pendientes: stats.sin_match + stats.sugerido,
        stats,
        pagination: { limit, offset },
    });
}
