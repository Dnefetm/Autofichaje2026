import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { registrarWebAdapters, obtenerWebAdapter } from '@/lib/web';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Idempotente: registra dai/tuk/urrea.
registrarWebAdapters();

/**
 * POST /api/enriquecer-web
 * body: { articulo_id }  o  { proveedor, codigo, descripcion?, categoria1?, categoria2?, ean? }
 * Resuelve los datos del producto, llama al adapter web del proveedor y devuelve el enriquecimiento.
 */
export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    const articuloId = String(body?.articulo_id ?? '').trim();

    let proveedor = String(body?.proveedor ?? '').trim();
    let codigo = String(body?.codigo ?? '').trim();
    let descripcion = String(body?.descripcion ?? '').trim();
    let categoria1 = body?.categoria1 ?? null;
    let categoria2 = body?.categoria2 ?? null;
    let ean = body?.ean ?? null;

    // Resolver desde el artículo si no vienen los campos explícitos
    if (articuloId) {
        const { data: art } = await supabaseAdmin
            .from('articulos')
            .select('modelo, nombre, descripcion, codigo_universal, marca')
            .eq('articulo_id', articuloId)
            .maybeSingle();
        if (!art) return NextResponse.json({ ok: false, error: 'Artículo no encontrado' }, { status: 404 });

        const { data: alias } = await supabaseAdmin
            .from('proveedor_articulos_alias')
            .select('proveedor, modelo_excel')
            .eq('articulo_id', articuloId)
            .limit(1)
            .maybeSingle();

        if (!proveedor) proveedor = String(alias?.proveedor ?? art.marca ?? '');
        if (!codigo) codigo = String(alias?.modelo_excel ?? art.modelo ?? '');
        if (!descripcion) descripcion = String(art.nombre ?? art.descripcion ?? '');
        if (!ean) ean = art.codigo_universal ?? null;
    }

    if (!proveedor || !codigo) {
        return NextResponse.json({ ok: false, error: 'proveedor y codigo requeridos (o articulo_id)' }, { status: 400 });
    }

    // Categoria1/2 (Tuk: FAMILIA/TIPO) viven en precios_proveedor (vigente).
    if (categoria1 == null || categoria2 == null) {
        const { data: pp } = await supabaseAdmin
            .from('precios_proveedor')
            .select('descripcion, categoria1, categoria2, codigo_barra')
            .eq('proveedor', proveedor)
            .eq('sku_proveedor', codigo)
            .eq('vigente', true)
            .limit(1)
            .maybeSingle();
        if (pp) {
            if (!descripcion) descripcion = String(pp.descripcion ?? '');
            if (categoria1 == null) categoria1 = pp.categoria1 ?? null;
            if (categoria2 == null) categoria2 = pp.categoria2 ?? null;
            if (!ean) ean = pp.codigo_barra ?? null;
        }
    }

    const adapter = obtenerWebAdapter(proveedor);
    if (!adapter) {
        return NextResponse.json({ ok: false, error: `No hay adapter web para "${proveedor}"` }, { status: 400 });
    }

    const enriquecimiento = await adapter.buscar({
        proveedor,
        codigo,
        descripcion,
        categoria1: categoria1 ?? null,
        categoria2: categoria2 ?? null,
        ean: ean ?? null,
    });

    return NextResponse.json({ ok: true, proveedor, codigo, enriquecimiento });
}
