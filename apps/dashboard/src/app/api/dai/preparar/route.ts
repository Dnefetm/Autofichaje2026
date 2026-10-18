import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { extraerProductoDai, limpiarEan } from '@/lib/dai-extractor';
import { construirTituloDai, construirDescripcionDai } from '@/lib/dai-descripcion';

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
        const titulo = construirTituloDai(producto, fila.descripcion, sku);
        const descripcion = construirDescripcionDai(producto, titulo, fila.descripcion);
        const atrEsp: Record<string, any> = {};
        if (producto?.oem) atrEsp.OEM = producto.oem;
        if (Array.isArray(producto?.aplicaciones) && producto.aplicaciones.length > 0) atrEsp.compatibilidades = producto.aplicaciones;
        const { data: nuevo, error: nuevoErr } = await supabaseAdmin
            .from('articulos')
            .insert({
                articulo_id: crypto.randomUUID(),
                nombre: titulo.slice(0, 200),
                marca: 'DAI',
                modelo: sku,
                codigo_universal: ean,
                codigo_sat: fila.codigo_sat || null,
                url_imagen: producto?.imagen || null,
                descripcion: descripcion.slice(0, 2000),
                atributos_especificos: Object.keys(atrEsp).length > 0 ? atrEsp : null,
                activo: true,
            })
            .select('articulo_id')
            .single();
        if (nuevoErr || !nuevo?.articulo_id) {
            return NextResponse.json({ ok: false, error: `No se pudo crear el artículo: ${nuevoErr?.message}` }, { status: 500 });
        }
        articuloId = nuevo.articulo_id;
    }

    // Actualizar foto/aplicaciones si el artículo ya existía (re-preparar)
    if (articuloId) {
        const titulo = construirTituloDai(producto, fila.descripcion, sku);
        const descripcionFull = construirDescripcionDai(producto, titulo, fila.descripcion);
        const patch: Record<string, any> = {};

        // Leer estado actual para no sobrescribir ediciones manuales del nombre/descripción.
        const { data: artActual } = await supabaseAdmin
            .from('articulos')
            .select('nombre, descripcion, atributos_especificos')
            .eq('articulo_id', articuloId)
            .maybeSingle();

        if (producto?.imagen) patch.url_imagen = producto.imagen;

        // Completa el nombre solo si aún conserva la forma abreviada original.
        const crudo = String(fila.descripcion ?? '').trim();
        const nombreActual = String(artActual?.nombre ?? '');
        if (!nombreActual || nombreActual === crudo || nombreActual === sku) {
            patch.nombre = titulo.slice(0, 200);
        }
        const descripcionActual = String(artActual?.descripcion ?? '');
        if (!descripcionActual || descripcionActual.startsWith(crudo)) {
            patch.descripcion = descripcionFull;
        }

        // Merge de atributos_especificos (OEM + compatibilidades) sin sobrescribir lo existente
        if (producto?.oem || (Array.isArray(producto?.aplicaciones) && producto.aplicaciones.length > 0)) {
            const atrEsp: Record<string, any> = { ...(artActual?.atributos_especificos || {}) };
            if (producto?.oem) atrEsp.OEM = producto.oem;
            if (Array.isArray(producto?.aplicaciones) && producto.aplicaciones.length > 0) atrEsp.compatibilidades = producto.aplicaciones;
            patch.atributos_especificos = atrEsp;
        }

        if (Object.keys(patch).length > 0) {
            await supabaseAdmin.from('articulos').update(patch).eq('articulo_id', articuloId);
        }
    }

    // 4) Vincular alias (proveedor DAI → artículo). La tabla NO tiene índice único
    //    sobre (proveedor, modelo_excel) — sus únicos únicos son (proveedor,codigo_excel)
    //    y (proveedor,marca_excel,modelo_excel) — así que hacemos select + insert/update por id.
    const aliasPayload = {
        proveedor: fila.proveedor,
        codigo_excel: ean || null,
        modelo_excel: sku,
        marca_excel: 'DAI',
        articulo_id: articuloId,
        locked: true,
    };
    let aliasErr: any = null;
    const { data: aliasExistente, error: aliasLookupErr } = await supabaseAdmin
        .from('proveedor_articulos_alias')
        .select('id')
        .eq('proveedor', fila.proveedor)
        .eq('modelo_excel', sku)
        .limit(1);
    if (aliasLookupErr) {
        aliasErr = aliasLookupErr;
    } else if (aliasExistente && aliasExistente.length > 0) {
        const { error: upErr } = await supabaseAdmin
            .from('proveedor_articulos_alias')
            .update(aliasPayload)
            .eq('id', aliasExistente[0].id);
        aliasErr = upErr;
    } else {
        const { error: insErr } = await supabaseAdmin
            .from('proveedor_articulos_alias')
            .insert(aliasPayload);
        aliasErr = insErr;
    }

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
