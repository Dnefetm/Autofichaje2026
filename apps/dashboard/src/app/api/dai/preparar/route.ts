import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { extraerProductoDai, limpiarEan } from '@/lib/dai-extractor';
import { construirTituloDai, construirDescripcionDai } from '@/lib/dai-descripcion';
import { registrarWebAdapters, obtenerWebAdapter } from '@/lib/web';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

registrarWebAdapters();

const ES_DAI = (proveedor: string) => (proveedor || '').trim() === 'DAI Autopartes';

/**
 * POST /api/dai/preparar  { sku, proveedor }
 * Prepara un artículo a partir de la lista de precios del proveedor (DAI u otro):
 *  - DAI: enriquece desde dai.com.mx (foto + aplicaciones + OEM).
 *  - Otros (Tuk/Urrea/Wurth): enriquece desde la web oficial del proveedor (web adapter).
 * Crea/asegura el artículo y vincula el alias (proveedor → artículo).
 */
export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    const sku = String(body?.sku ?? '').trim();
    const proveedor = String(body?.proveedor ?? '').trim() || 'DAI Autopartes';
    if (!sku) return NextResponse.json({ ok: false, error: 'sku requerido' }, { status: 400 });
    const esDai = ES_DAI(proveedor);

    // 1) Fila de la lista
    const { data: fila, error: filaErr } = await supabaseAdmin
        .from('precios_proveedor')
        .select('sku_proveedor, codigo_barra, descripcion, valor, codigo_sat, proveedor, marca, categoria1, categoria2')
        .eq('sku_proveedor', sku)
        .eq('proveedor', proveedor)
        .eq('vigente', true)
        .order('valor', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (filaErr || !fila) {
        return NextResponse.json({ ok: false, error: `SKU ${sku} no encontrado en la lista de ${proveedor}` }, { status: 404 });
    }

    const ean = limpiarEan(fila.codigo_barra);

    // 2) Enriquecer: DAI usa dai.com.mx; el resto usa el web adapter del proveedor.
    let producto: any = null;
    let imagenWeb: string | null = null;
    let descripcionWeb: string | null = null;
    if (esDai) {
        try { producto = await extraerProductoDai(sku); } catch { /* web caída: seguimos sin foto */ }
    } else {
        const adapter = obtenerWebAdapter(proveedor);
        if (adapter) {
            try {
                const web = await adapter.buscar({
                    proveedor,
                    codigo: sku,
                    descripcion: String(fila.descripcion ?? ''),
                    categoria1: fila.categoria1 ?? null,
                    categoria2: fila.categoria2 ?? null,
                    ean: ean ?? null,
                });
                imagenWeb = web?.imagen || null;
                descripcionWeb = web?.descripcionLarga || null;
            } catch { /* sin enriquecimiento web */ }
        }
    }

    // 3) Título / descripción / marca según proveedor
    const marca = esDai ? 'DAI' : (String(fila.marca ?? '').trim() || proveedor);
    const titulo = esDai
        ? construirTituloDai(producto, fila.descripcion, sku)
        : (String(fila.descripcion ?? '').trim() || sku);
    const descripcion = esDai
        ? construirDescripcionDai(producto, titulo, fila.descripcion)
        : (descripcionWeb || String(fila.descripcion ?? '').trim() || sku);
    const urlImagen = esDai ? (producto?.imagen || null) : imagenWeb;

    // 4) Asegurar artículo (por EAN o por modelo+marca del proveedor)
    let articuloId: string | null = null;
    const q = supabaseAdmin.from('articulos').select('articulo_id').limit(1);
    if (ean) {
        const { data: porEan } = await q.eq('codigo_universal', ean).maybeSingle();
        if (porEan?.articulo_id) articuloId = porEan.articulo_id;
    }
    if (!articuloId) {
        const { data: porModelo } = await supabaseAdmin.from('articulos')
            .select('articulo_id').eq('modelo', sku).eq('marca', marca).limit(1).maybeSingle();
        if (porModelo?.articulo_id) articuloId = porModelo.articulo_id;
    }
    if (!articuloId) {
        const atrEsp: Record<string, any> = {};
        if (esDai && producto?.oem) atrEsp.OEM = producto.oem;
        if (esDai && Array.isArray(producto?.aplicaciones) && producto.aplicaciones.length > 0) atrEsp.compatibilidades = producto.aplicaciones;
        const { data: nuevo, error: nuevoErr } = await supabaseAdmin
            .from('articulos')
            .insert({
                articulo_id: crypto.randomUUID(),
                nombre: titulo.slice(0, 200),
                marca,
                modelo: sku,
                codigo_universal: ean,
                codigo_sat: fila.codigo_sat || null,
                url_imagen: urlImagen,
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

    // Actualizar foto/descripción si el artículo ya existía (re-preparar)
    if (articuloId) {
        const patch: Record<string, any> = {};
        const { data: artActual } = await supabaseAdmin
            .from('articulos')
            .select('nombre, descripcion, atributos_especificos')
            .eq('articulo_id', articuloId)
            .maybeSingle();

        if (urlImagen) patch.url_imagen = urlImagen;

        const crudo = String(fila.descripcion ?? '').trim();
        const nombreActual = String(artActual?.nombre ?? '');
        if (!nombreActual || nombreActual === crudo || nombreActual === sku) {
            patch.nombre = titulo.slice(0, 200);
        }
        const descripcionActual = String(artActual?.descripcion ?? '');
        if (!descripcionActual || descripcionActual.startsWith(crudo)) {
            patch.descripcion = descripcion.slice(0, 2000);
        }

        if (esDai && (producto?.oem || (Array.isArray(producto?.aplicaciones) && producto.aplicaciones.length > 0))) {
            const atrEsp: Record<string, any> = { ...(artActual?.atributos_especificos || {}) };
            if (producto?.oem) atrEsp.OEM = producto.oem;
            if (Array.isArray(producto?.aplicaciones) && producto.aplicaciones.length > 0) atrEsp.compatibilidades = producto.aplicaciones;
            patch.atributos_especificos = atrEsp;
        }

        if (Object.keys(patch).length > 0) {
            await supabaseAdmin.from('articulos').update(patch).eq('articulo_id', articuloId);
        }
    }

    // 5) Vincular alias (proveedor → artículo).
    const aliasPayload = {
        proveedor: fila.proveedor,
        codigo_excel: ean || null,
        modelo_excel: sku,
        marca_excel: marca,
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
        imagen: urlImagen,
        w360: esDai ? (producto?.w360 || null) : null,
        aplicaciones: esDai ? (producto?.aplicaciones || []) : [],
        alias_error: aliasErr?.message || null,
    });
}
