import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { ArrowLeft, Info } from 'lucide-react';
import { VinculacionCategoria } from '@/components/precios/VinculacionCategoria';

export const dynamic = 'force-dynamic';

export default async function VinculacionPage(props: {
    params: Promise<{ proveedor: string; importacion_id: string }>;
}) {
    const params = await props.params;
    const proveedorDecoded = decodeURIComponent(params.proveedor);
    const importacionId = params.importacion_id;

    const { data: imp } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, nombre_archivo, total_filas, estado')
        .eq('id', importacionId)
        .single();

    // ── 1. Cargar todas las filas raw del lote ────────────────────────────────
    let allRaw: any[] = [];
    let from = 0;
    while (true) {
        const { data: chunk } = await supabaseAdmin
            .from('listas_precios_raw')
            .select('fila_num, payload')
            .eq('importacion_id', importacionId)
            .range(from, from + 999);
        if (!chunk || chunk.length === 0) break;
        allRaw = allRaw.concat(chunk);
        if (chunk.length < 1000) break;
        from += 1000;
    }

    // ── 2. Extraer campos clave de cada fila ──────────────────────────────────
    type FilaExcel = {
        fila_num: number;
        clave: string;          // SKU / modelo del proveedor
        codigo_barra: string;   // EAN / código universal
        marca: string;
        descripcion: string;
        dist: number;
        menudeo: number;
    };

    const filas: FilaExcel[] = allRaw.map(r => {
        const p = r.payload || {};
        return {
            fila_num: r.fila_num,
            clave: p['CLAVE'] || p['CÓDIGO'] || '',
            codigo_barra: p['CÓDIGO DE BARRA SIN CERO'] || '',
            marca: p['MARCA'] || '',
            descripcion: p['DESCRIPCIÓN LARGA'] || p['DESCRIPCION'] || '',
            dist: parseFloat(p['P.DIST (CON IVA)'] || '0') || 0,
            menudeo: parseFloat(p['PRECIO MENUDEO (CON IVA)'] || '0') || 0,
        };
    });

    // ── 3. Alias ya aprobados manualmente (locked=true) ───────────────────────
    const { data: aliasExistentes } = await supabaseAdmin
        .from('proveedor_articulos_alias')
        .select('codigo_excel, modelo_excel, marca_excel, articulo_id, locked')
        .eq('proveedor', proveedorDecoded);

    const aliasLockedPorCodigo = new Map<string, string>();
    const aliasLockedPorModelo = new Map<string, string>();
    aliasExistentes?.forEach(a => {
        if (a.locked && a.codigo_excel) aliasLockedPorCodigo.set(a.codigo_excel, a.articulo_id);
        if (a.locked && a.modelo_excel && a.marca_excel)
            aliasLockedPorModelo.set(`${a.marca_excel}|||${a.modelo_excel}`, a.articulo_id);
    });

    // ── 4. Buscar artículos por código de barras (código universal) ───────────
    const codigosUnicos = [...new Set(filas.map(f => f.codigo_barra).filter(Boolean))];
    const articulosPorCodigo = new Map<string, any>();

    for (let i = 0; i < codigosUnicos.length; i += 500) {
        const lote = codigosUnicos.slice(i, i + 500);
        const { data: arts } = await supabaseAdmin
            .from('articulos')
            .select('articulo_id, nombre, modelo, marca, codigo_universal, sku')
            .in('codigo_universal', lote)
            .eq('activo', true);
        arts?.forEach(a => {
            if (a.codigo_universal) articulosPorCodigo.set(a.codigo_universal, a);
        });
    }

    // ── 5. Buscar artículos por Marca + Modelo (clave) ────────────────────────
    const clavesUnicas = [...new Set(filas.map(f => f.clave).filter(Boolean))];
    const articulosPorModelo = new Map<string, any>(); // key: "MARCA|||MODELO"

    // Consultar artículos donde modelo coincida con alguna clave del Excel
    for (let i = 0; i < clavesUnicas.length; i += 300) {
        const lote = clavesUnicas.slice(i, i + 300);
        const { data: arts } = await supabaseAdmin
            .from('articulos')
            .select('articulo_id, nombre, modelo, marca, codigo_universal, sku')
            .in('modelo', lote)
            .eq('activo', true);
        arts?.forEach(a => {
            if (a.modelo && a.marca)
                articulosPorModelo.set(`${a.marca}|||${a.modelo}`, a);
            // También por modelo solo (sin marca exacta)
            if (a.modelo)
                articulosPorModelo.set(`|||${a.modelo}`, a);
        });
    }

    // ── 6. Clasificar cada fila ───────────────────────────────────────────────
    type ItemMatch = {
        fila_num: number;
        sku_proveedor: string;
        codigo_barra: string;
        marca_proveedor: string;
        descripcion_proveedor: string;
        dist: number;
        menudeo: number;
        articulo_id: string;
        nombre_catalogo: string;
        sku_catalogo: string;
        marca_catalogo: string;
        modelo_catalogo: string;
        codigo_universal: string;
    };

    // Categorías de matching
    const cat_triple: ItemMatch[] = [];      // Código + Marca + Modelo coinciden
    const cat_solo_codigo: ItemMatch[] = []; // Solo código de barras coincide
    const cat_marca_modelo: ItemMatch[] = []; // Solo Marca + Modelo coinciden (sin código)
    const ya_vinculados: ItemMatch[] = [];   // Ya tiene alias aprobado (locked=true)
    let sin_match = 0;

    for (const fila of filas) {
        // ¿Ya está vinculado manualmente?
        const artIdLocked = aliasLockedPorCodigo.get(fila.codigo_barra)
            || aliasLockedPorModelo.get(`${fila.marca}|||${fila.clave}`);
        if (artIdLocked) {
            const art = articulosPorCodigo.get(fila.codigo_barra)
                || articulosPorModelo.get(`${fila.marca}|||${fila.clave}`)
                || articulosPorModelo.get(`|||${fila.clave}`);
            ya_vinculados.push({
                fila_num: fila.fila_num,
                sku_proveedor: fila.clave,
                codigo_barra: fila.codigo_barra,
                marca_proveedor: fila.marca,
                descripcion_proveedor: fila.descripcion,
                dist: fila.dist,
                menudeo: fila.menudeo,
                articulo_id: artIdLocked,
                nombre_catalogo: art?.nombre || '(sin nombre)',
                sku_catalogo: art?.sku || '',
                marca_catalogo: art?.marca || '',
                modelo_catalogo: art?.modelo || '',
                codigo_universal: art?.codigo_universal || '',
            });
            continue;
        }

        const artPorCodigo = fila.codigo_barra ? articulosPorCodigo.get(fila.codigo_barra) : null;
        const artPorModelo = fila.clave
            ? (articulosPorModelo.get(`${fila.marca}|||${fila.clave}`)
                || articulosPorModelo.get(`|||${fila.clave}`))
            : null;

        if (artPorCodigo) {
            const marcaMatch = artPorCodigo.marca?.toLowerCase() === fila.marca?.toLowerCase();
            const modeloMatch = artPorCodigo.modelo?.toLowerCase() === fila.clave?.toLowerCase();

            const item: ItemMatch = {
                fila_num: fila.fila_num,
                sku_proveedor: fila.clave,
                codigo_barra: fila.codigo_barra,
                marca_proveedor: fila.marca,
                descripcion_proveedor: fila.descripcion,
                dist: fila.dist,
                menudeo: fila.menudeo,
                articulo_id: artPorCodigo.articulo_id,
                nombre_catalogo: artPorCodigo.nombre || '',
                sku_catalogo: artPorCodigo.sku || '',
                marca_catalogo: artPorCodigo.marca || '',
                modelo_catalogo: artPorCodigo.modelo || '',
                codigo_universal: artPorCodigo.codigo_universal || '',
            };

            if (marcaMatch && modeloMatch) {
                cat_triple.push(item);
            } else {
                cat_solo_codigo.push(item);
            }
        } else if (artPorModelo) {
            cat_marca_modelo.push({
                fila_num: fila.fila_num,
                sku_proveedor: fila.clave,
                codigo_barra: fila.codigo_barra,
                marca_proveedor: fila.marca,
                descripcion_proveedor: fila.descripcion,
                dist: fila.dist,
                menudeo: fila.menudeo,
                articulo_id: artPorModelo.articulo_id,
                nombre_catalogo: artPorModelo.nombre || '',
                sku_catalogo: artPorModelo.sku || '',
                marca_catalogo: artPorModelo.marca || '',
                modelo_catalogo: artPorModelo.modelo || '',
                codigo_universal: artPorModelo.codigo_universal || '',
            });
        } else {
            sin_match++;
        }
    }

    const totalPropuestas = cat_triple.length + cat_solo_codigo.length + cat_marca_modelo.length;

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 px-8 py-5">
                <Link
                    href={`/precios/${encodeURIComponent(proveedorDecoded)}/historial/${importacionId}/resumen`}
                    className="inline-flex items-center text-sm text-slate-500 hover:text-indigo-600 mb-3"
                >
                    <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Resumen del Lote
                </Link>
                <h1 className="text-2xl font-bold text-slate-900">Vinculación con Catálogo Interno</h1>
                <p className="text-sm text-slate-500 mt-1">
                    {imp?.nombre_archivo} · {imp?.total_filas?.toLocaleString()} SKUs del proveedor
                </p>

                {/* Tarjetas resumen */}
                <div className="grid grid-cols-4 gap-4 mt-5">
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4">
                        <div className="text-2xl font-black text-emerald-700">{cat_triple.length.toLocaleString()}</div>
                        <div className="text-xs font-bold text-emerald-600 mt-1">Código + Marca + Modelo</div>
                        <div className="text-[10px] text-emerald-500">Triple coincidencia — máxima confianza</div>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
                        <div className="text-2xl font-black text-amber-700">{cat_solo_codigo.length.toLocaleString()}</div>
                        <div className="text-xs font-bold text-amber-600 mt-1">Solo Código de Barras</div>
                        <div className="text-[10px] text-amber-500">EAN coincide, marca/modelo difieren</div>
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4">
                        <div className="text-2xl font-black text-blue-700">{cat_marca_modelo.length.toLocaleString()}</div>
                        <div className="text-xs font-bold text-blue-600 mt-1">Solo Marca + Modelo</div>
                        <div className="text-[10px] text-blue-500">Sin código de barras, clave coincide</div>
                    </div>
                    <div className="bg-slate-100 border border-slate-200 rounded-xl px-5 py-4">
                        <div className="text-2xl font-black text-slate-600">{sin_match.toLocaleString()}</div>
                        <div className="text-xs font-bold text-slate-500 mt-1">Sin Coincidencia</div>
                        <div className="text-[10px] text-slate-400">No encontrado en catálogo</div>
                    </div>
                </div>

                <div className="mt-3 flex items-start gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5">
                    <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
                    <span>
                        Cada categoría muestra la comparativa completa lado a lado. Puedes aceptar todos los de una categoría con un clic,
                        o revisar y decidir fila por fila. Solo los que aceptes se guardarán como vínculos confirmados.
                    </span>
                </div>
            </header>

            {/* Categorías */}
            <div className="px-8 py-6">
                {cat_triple.length > 0 && (
                    <VinculacionCategoria
                        categoria="triple"
                        titulo="Código de Barras + Marca + Modelo coinciden"
                        descripcion="El EAN/código universal, la marca y el modelo son idénticos en ambos lados. Confianza máxima."
                        color="emerald"
                        items={cat_triple}
                        proveedor={proveedorDecoded}
                    />
                )}
                {cat_solo_codigo.length > 0 && (
                    <VinculacionCategoria
                        categoria="solo_codigo"
                        titulo="Solo Código de Barras coincide"
                        descripcion="El EAN/código universal coincide pero la marca o el modelo difieren. Revisa antes de aceptar."
                        color="amber"
                        items={cat_solo_codigo}
                        proveedor={proveedorDecoded}
                    />
                )}
                {cat_marca_modelo.length > 0 && (
                    <VinculacionCategoria
                        categoria="marca_modelo"
                        titulo="Solo Marca + Modelo coinciden (sin código de barras)"
                        descripcion="No hay código de barras en el Excel para comparar. La coincidencia es solo por clave/modelo. Verifica."
                        color="blue"
                        items={cat_marca_modelo}
                        proveedor={proveedorDecoded}
                    />
                )}
                {totalPropuestas === 0 && (
                    <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
                        No hay propuestas de vinculación pendientes para este lote.
                    </div>
                )}
            </div>
        </div>
    );
}
