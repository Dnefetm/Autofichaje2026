import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(
    req: NextRequest,
    props: { params: Promise<{ proveedor: string }> }
) {
    const { proveedor: provParam } = await props.params;
    const proveedor = decodeURIComponent(provParam);
    const { searchParams } = req.nextUrl;
    const q = searchParams.get('q') || '';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Obtener la última importación vigente o más reciente del proveedor
    const { data: listaVigente } = await supabaseAdmin
        .from('listas_precios_proveedor')
        .select('importacion_id')
        .eq('proveedor', proveedor)
        .eq('vigente', true)
        .order('creado_el', { ascending: false })
        .limit(1)
        .maybeSingle();

    let importacionId = listaVigente?.importacion_id;

    if (!importacionId) {
        // Fallback a la última importación registrada
        const { data: ultImp } = await supabaseAdmin
            .from('importaciones_excel')
            .select('id')
            .eq('proveedor', proveedor)
            .in('estado', ['en_revision', 'completado', 'matching_completo'])
            .order('creado_el', { ascending: false })
            .limit(1)
            .maybeSingle();
        importacionId = ultImp?.id;
    }

    if (!importacionId) {
        return NextResponse.json({ ok: true, items: [], total: 0, mensaje: 'No hay lista de precios registrada para este proveedor' });
    }

    // Consultar filas de listas_precios_raw
    let query = supabaseAdmin
        .from('listas_precios_raw')
        .select('id, fila_num, payload, created_at', { count: 'exact' })
        .eq('importacion_id', importacionId)
        .order('fila_num', { ascending: true })
        .range(offset, offset + limit - 1);

    const { data: rows, count, error } = await query;

    if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    // Consultar alias existentes para este proveedor
    const { data: aliasList } = await supabaseAdmin
        .from('proveedor_articulos_alias')
        .select('codigo_excel, modelo_excel, marca_excel, articulo_id')
        .eq('proveedor', proveedor);

    const aliasMap = new Map<string, string>();
    aliasList?.forEach(a => {
        if (a.codigo_excel) aliasMap.set(`code:${a.codigo_excel}`, a.articulo_id);
        if (a.modelo_excel) aliasMap.set(`model:${a.modelo_excel}`, a.articulo_id);
    });

    const items = (rows || []).map(r => {
        const payload = r.payload || {};
        const modelo = payload['CLAVE'] || payload['MODELO'] || payload['Modelo'] || '';
        const codigo = payload['CÓDIGO DE BARRA SIN CERO'] || payload['CÓDIGO DE BARRA'] || payload['CODIGO'] || payload['Codigo'] || '';
        const articuloId = aliasMap.get(`code:${codigo}`) || aliasMap.get(`model:${modelo}`) || null;

        return {
            id: r.id,
            fila_num: r.fila_num,
            modelo,
            codigo,
            marca: payload['MARCA'] || payload['Marca'] || '',
            descripcion: payload['DESCRIPCIÓN LARGA'] || payload['DESCRIPCION'] || payload['Descripcion'] || '',
            precio_distribuidor: payload['P.DIST (CON IVA)'] || payload['P.DIST'] || payload['PRECIO DISTRIBUIDOR'] || null,
            payload,
            vinculado_a_articulo_id: articuloId
        };
    });

    return NextResponse.json({
        ok: true,
        importacion_id: importacionId,
        total: count || 0,
        items
    });
}
