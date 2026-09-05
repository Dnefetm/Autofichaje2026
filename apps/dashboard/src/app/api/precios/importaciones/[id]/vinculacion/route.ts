import { supabaseAdmin } from '@/lib/supabase';
import { friendlyError } from '@/lib/friendlyError';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CATEGORIAS = ['triple', 'solo_codigo', 'marca_modelo', 'ya_vinculado', 'sin_match', 'rechazado'] as const;
type Categoria = (typeof CATEGORIAS)[number];

const SELECT_COLS =
    'fila_num, articulo_id, nombre_catalogo, marca_catalogo, modelo_catalogo, codigo_universal, sku_proveedor, codigo_barra, marca_proveedor, descripcion_proveedor, dist, menudeo';

// GET /api/precios/importaciones/[id]/vinculacion?categoria=triple&page=0&pageSize=100
// Materializa el lote la primera vez (si la tabla está vacía para esa importación)
// y devuelve los totales de TODAS las categorías + la página pedida.
export async function GET(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const { id: importacionId } = await props.params;
    const sp = req.nextUrl.searchParams;
    const categoriaRaw = sp.get('categoria') || 'triple';
    const categoria: Categoria = (CATEGORIAS as readonly string[]).includes(categoriaRaw)
        ? (categoriaRaw as Categoria)
        : 'triple';
    const page = Math.max(0, parseInt(sp.get('page') || '0', 10) || 0);
    const pageSize = Math.min(200, Math.max(1, parseInt(sp.get('pageSize') || '100', 10) || 100));

    // Proveedor desde la propia importación (más robusto que confiar en el query param)
    let proveedor = sp.get('proveedor') || '';
    const { data: imp } = await supabaseAdmin
        .from('importaciones_excel')
        .select('proveedor')
        .eq('id', importacionId)
        .single();
    if (imp?.proveedor) proveedor = imp.proveedor;

    if (!proveedor) {
        return NextResponse.json({ ok: false, error: 'No se pudo determinar el proveedor del lote' }, { status: 400 });
    }

    // 1. Materializar si la tabla está vacía para este lote (costo one-time ~3.7s)
    const { count: matCount } = await supabaseAdmin
        .from('vinculacion_clasificada')
        .select('fila_num', { count: 'exact', head: true })
        .eq('importacion_id', importacionId);

    if ((matCount ?? 0) === 0) {
        const { error: matErr } = await supabaseAdmin.rpc('fn_materializar_vinculacion', {
            p_importacion_id: importacionId,
            p_proveedor: proveedor,
        });
        if (matErr) {
            console.error('[vinculacion] materializar error:', matErr);
            return NextResponse.json({ ok: false, error: friendlyError(matErr) }, { status: 500 });
        }
    }

    // 2. Totales por categoría (consultas count indexadas, milisegundos)
    const counts = await Promise.all(
        CATEGORIAS.map((cat) =>
            supabaseAdmin
                .from('vinculacion_clasificada')
                .select('fila_num', { count: 'exact', head: true })
                .eq('importacion_id', importacionId)
                .eq('categoria', cat)
        )
    );
    const totales: Record<Categoria, number> = {
        triple: counts[0].count ?? 0,
        solo_codigo: counts[1].count ?? 0,
        marca_modelo: counts[2].count ?? 0,
        ya_vinculado: counts[3].count ?? 0,
        sin_match: counts[4].count ?? 0,
        rechazado: counts[5].count ?? 0,
    };

    // 3. Página pedida
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count: totalCategoria } = await supabaseAdmin
        .from('vinculacion_clasificada')
        .select(SELECT_COLS, { count: 'exact' })
        .eq('importacion_id', importacionId)
        .eq('categoria', categoria)
        .order('fila_num', { ascending: true })
        .range(from, to);

    if (error) {
        console.error('[vinculacion] query error:', error);
        return NextResponse.json({ ok: false, error: friendlyError(error) }, { status: 500 });
    }

    const rows = (data ?? []).map((r: any) => ({
        fila_num: r.fila_num,
        articulo_id: r.articulo_id ?? '',
        nombre_catalogo: r.nombre_catalogo ?? '',
        marca_catalogo: r.marca_catalogo ?? '',
        modelo_catalogo: r.modelo_catalogo ?? '',
        codigo_universal: r.codigo_universal ?? '',
        sku_proveedor: r.sku_proveedor ?? '',
        codigo_barra: r.codigo_barra ?? '',
        marca_proveedor: r.marca_proveedor ?? '',
        descripcion_proveedor: r.descripcion_proveedor ?? '',
        dist: Number(r.dist ?? 0),
        menudeo: Number(r.menudeo ?? 0),
    }));

    const total = totalCategoria ?? rows.length;

    return NextResponse.json({
        ok: true,
        totales,
        categoria,
        rows,
        page,
        pageSize,
        totalCategoria: total,
        hasMore: from + rows.length < total,
    });
}
