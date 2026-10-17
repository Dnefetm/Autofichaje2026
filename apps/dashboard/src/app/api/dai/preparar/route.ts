import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { extraerProductoDai, limpiarEan } from '@/lib/dai-extractor';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/dai/preparar  { sku }
 * 1) Lee la fila de la lista DAI (precios_proveedor).
 * 2) Enriquecce desde dai.com.mx (foto + aplicaciones).
 * 3) Crea/asegura el artículo y vincula el alias (proveedor → artículo).
 * Devuelve { articulo_id, imagen, aplicaciones, precio_costo }.
 * El precio de VENTA NO se calcula aquí: lo hace fn_calcular_precio_prepublicacion
 * usando el vínculo proveedor_articulos_alias (costo base + regla de margen).
 */
export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    const sku = String(body?.sku ?? '').trim();
    const proveedor = String(body?.proveedor ?? '').trim() || 'DAI Autopartes';
    if (!sku) return NextResponse.json({ ok: false, error: 'sku requerido' }, { status: 400 });

    // 1) Fila de la lista
    const { data: fila, error: filaErr } = await supabaseAdmin
        .from('precios_proveedor')
        .select('sku_proveedor, codigo_barra, descripcion, valor, codigo_sat, proveedor')
        .eq('sku_proveedor', sku)
        .eq('proveedor', proveedor)
        .eq('vigente', true)
        .order('valor', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (filaErr || !fila) {
        return NextResponse.json({ ok: false, error: `SKU ${sku} no encontrado en la lista DAI` }, { status: 404 });
    }

    // 2) Enriquecer desde dai.com.mx
    let producto = null;
    try { producto = await extraerProductoDai(sku); } catch { /* web caída: seguimos sin foto */ }

    const ean = limpiarEan(fila.codigo_barra);

    // 3) Asegurar artículo (por EAN o por modelo+marca DAI)
    let articuloId: string | null = null;
    const q = supabaseAdmin.from('articulos').select('articulo_id').limit(1);
    if (ean) {
        const { data: porEan } = await q.eq('codigo_universal', ean).maybeSingle();
        if (porEan?.articulo_id) articuloId = porEan.articulo_id;
    }
    if (!articuloId) {
        const { data: porModelo } = await supabaseAdmin.from('articulos')
            .select('articulo_id').eq('modelo', sku).eq('marca', 'DAI').limit(1).maybeSingle();
        if (porModelo?.articulo_id) articuloId = porModelo.articulo_id;
    }
    if (!articuloId) {
        const aplicacionesTxt = (producto?.aplicaciones || [])
            .map((a) => `${a.marca} ${a.modelo} ${a.anio}${a.anioF ? '-' + a.anioF : ''}${a.motor ? ' ' + a.motor : ''}`.trim())
            .filter(Boolean).join(' | ');
        const descripcion = [fila.descripcion, aplicacionesTxt].filter(Boolean).join('\nAplicaciones: ');
        const { data: nuevo, error: nuevoErr } = await supabaseAdmin
            .from('articulos')
            .insert({
                articulo_id: crypto.randomUUID(),
                nombre: (fila.descripcion || sku).slice(0, 200),
                marca: 'DAI',
                modelo: sku,
                codigo_universal: ean,
                codigo_sat: fila.codigo_sat || null,
                url_imagen: producto?.imagen || null,
                descripcion: descripcion.slice(0, 2000),
                activo: true,
            })
            .select('articulo_id')
            .single();
        if (nuevoErr || !nuevo?.articulo_id) {
            return NextResponse.json({ ok: false, error: `No se pudo crear el artículo: ${nuevoErr?.message}` }, { status: 500 });
        }
        articuloId = nuevo.articulo_id;
    }

    // 4) Vincular alias (proveedor DAI → artículo)
    const { error: aliasErr } = await supabaseAdmin
        .from('proveedor_articulos_alias')
        .upsert({
            proveedor: fila.proveedor,
            codigo_excel: ean || null,
            modelo_excel: sku,
            marca_excel: 'DAI',
            articulo_id: articuloId,
            locked: true,
        }, { onConflict: 'proveedor,modelo_excel' });

    return NextResponse.json({
        ok: true,
        articulo_id: articuloId,
        sku,
        ean,
        precio_costo: fila.valor,
        codigo_sat: fila.codigo_sat || null,
        imagen: producto?.imagen || null,
        w360: producto?.w360 || null,
        aplicaciones: producto?.aplicaciones || [],
        alias_error: aliasErr?.message || null,
    });
}
