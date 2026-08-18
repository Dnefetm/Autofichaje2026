import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle, Link2 } from 'lucide-react';
import { VinculacionActions } from '@/components/precios/VinculacionActions';

export const dynamic = 'force-dynamic';

export default async function VinculacionPage(props: {
    params: Promise<{ proveedor: string; importacion_id: string }>;
    searchParams: Promise<any>;
}) {
    const params = await props.params;
    const searchParams = await props.searchParams;
    const proveedorDecoded = decodeURIComponent(params.proveedor);
    const importacionId = params.importacion_id;
    const filtro = searchParams.filtro || 'propuestos'; // propuestos | aceptados | sin_match
    const page = parseInt(searchParams.page || '0', 10);
    const pageSize = 100;

    // Datos de la importación
    const { data: imp } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, nombre_archivo, total_filas, estado')
        .eq('id', importacionId)
        .single();

    // --- Obtener filas raw de esta importación ---
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

    // --- Alias ya confirmados para este proveedor ---
    const { data: aliasList } = await supabaseAdmin
        .from('proveedor_articulos_alias')
        .select('codigo_excel, modelo_excel, marca_excel, articulo_id')
        .eq('proveedor', proveedorDecoded);

    const aliasPorCodigo = new Map<string, string>();
    const aliasPorModelo = new Map<string, string>();
    aliasList?.forEach(a => {
        if (a.codigo_excel) aliasPorCodigo.set(a.codigo_excel, a.articulo_id);
        if (a.modelo_excel && a.marca_excel) aliasPorModelo.set(`${a.marca_excel}|||${a.modelo_excel}`, a.articulo_id);
    });

    // --- Artículos del catálogo para cross-match por codigo_universal ---
    // Traer artículos donde codigo_universal coincida con algún código de barras del Excel
    const codigosExcel = allRaw
        .map(r => r.payload?.['CÓDIGO DE BARRA SIN CERO'] || r.payload?.['CODIGO'] || '')
        .filter(Boolean);

    // Consultar artículos que coincidan por codigo_universal
    // Hacemos esto en lotes de 500 para evitar límites
    const articulosPorCodigo = new Map<string, any>();
    const articulosPorModelo = new Map<string, any>();

    for (let i = 0; i < codigosExcel.length; i += 500) {
        const lote = codigosExcel.slice(i, i + 500);
        const { data: arts } = await supabaseAdmin
            .from('articulos')
            .select('articulo_id, nombre, modelo, marca, codigo_universal, sku')
            .in('codigo_universal', lote)
            .eq('activo', true);
        arts?.forEach(a => {
            if (a.codigo_universal) articulosPorCodigo.set(a.codigo_universal, a);
        });
    }

    // --- Clasificar cada fila del Excel ---
    type ItemVinculacion = {
        fila_num: number;
        sku_proveedor: string;
        codigo_barra: string;
        marca: string;
        descripcion: string;
        dist: number;
        menudeo: number;
        tipo_match: 'alias_codigo' | 'alias_modelo' | 'catalogo_codigo' | 'sin_match';
        articulo_match: any | null;
        ya_vinculado: boolean;
    };

    const propuestos: ItemVinculacion[] = [];
    const sinMatch: ItemVinculacion[] = [];
    const yaVinculados: ItemVinculacion[] = [];

    allRaw.forEach(r => {
        const p = r.payload || {};
        const skuProveedor = p['CLAVE'] || p['CÓDIGO'] || '';
        const codigoBarra = p['CÓDIGO DE BARRA SIN CERO'] || p['CODIGO'] || '';
        const marca = p['MARCA'] || '';
        const modelo = p['CLAVE'] || '';
        const descripcion = p['DESCRIPCIÓN LARGA'] || p['DESCRIPCION'] || '';
        const dist = parseFloat(p['P.DIST (CON IVA)'] || p['P.DIST'] || '0') || 0;
        const menudeo = parseFloat(p['PRECIO MENUDEO (CON IVA)'] || '0') || 0;

        const articuloIdPorCodigo = aliasPorCodigo.get(codigoBarra);
        const articuloIdPorModelo = aliasPorModelo.get(`${marca}|||${modelo}`);
        const articuloCatalogo = articulosPorCodigo.get(codigoBarra);

        const item: ItemVinculacion = {
            fila_num: r.fila_num,
            sku_proveedor: skuProveedor,
            codigo_barra: codigoBarra,
            marca,
            descripcion,
            dist,
            menudeo,
            tipo_match: 'sin_match',
            articulo_match: null,
            ya_vinculado: false
        };

        if (articuloIdPorCodigo) {
            item.tipo_match = 'alias_codigo';
            item.articulo_match = { articulo_id: articuloIdPorCodigo };
            item.ya_vinculado = true;
            yaVinculados.push(item);
        } else if (articuloIdPorModelo) {
            item.tipo_match = 'alias_modelo';
            item.articulo_match = { articulo_id: articuloIdPorModelo };
            item.ya_vinculado = true;
            yaVinculados.push(item);
        } else if (articuloCatalogo) {
            item.tipo_match = 'catalogo_codigo';
            item.articulo_match = articuloCatalogo;
            item.ya_vinculado = false;
            propuestos.push(item);
        } else {
            item.tipo_match = 'sin_match';
            sinMatch.push(item);
        }
    });

    // Seleccionar lista según filtro activo
    const listaActiva = filtro === 'aceptados' ? yaVinculados : filtro === 'sin_match' ? sinMatch : propuestos;
    const paginada = listaActiva.slice(page * pageSize, page * pageSize + pageSize);
    const totalPaginas = Math.ceil(listaActiva.length / pageSize);

    const fmtMx = (n: number) => n > 0 ? n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) : '—';

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="bg-white border-b border-slate-200 px-8 py-5">
                <Link
                    href={`/precios/${encodeURIComponent(proveedorDecoded)}/historial/${importacionId}/resumen`}
                    className="inline-flex items-center text-sm text-slate-500 hover:text-indigo-600 mb-3"
                >
                    <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Resumen del Lote
                </Link>
                <div className="flex items-start justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">Vinculación con Catálogo Interno</h1>
                        <p className="text-sm text-slate-500 mt-1">
                            {imp?.nombre_archivo} · {imp?.total_filas?.toLocaleString()} SKUs del proveedor
                        </p>
                    </div>
                </div>

                {/* Tarjetas resumen */}
                <div className="grid grid-cols-3 gap-4 mt-5">
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4 flex items-center gap-4">
                        <CheckCircle2 className="w-8 h-8 text-emerald-500 shrink-0" />
                        <div>
                            <div className="text-2xl font-black text-emerald-700">{yaVinculados.length.toLocaleString()}</div>
                            <div className="text-xs font-bold text-emerald-600">Ya Vinculados</div>
                            <div className="text-xs text-emerald-500">Confirmados anteriormente</div>
                        </div>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex items-center gap-4">
                        <Link2 className="w-8 h-8 text-amber-500 shrink-0" />
                        <div>
                            <div className="text-2xl font-black text-amber-700">{propuestos.length.toLocaleString()}</div>
                            <div className="text-xs font-bold text-amber-600">Propuestas Pendientes</div>
                            <div className="text-xs text-amber-500">Match por código universal — pendiente de confirmar</div>
                        </div>
                    </div>
                    <div className="bg-slate-100 border border-slate-200 rounded-xl px-5 py-4 flex items-center gap-4">
                        <XCircle className="w-8 h-8 text-slate-400 shrink-0" />
                        <div>
                            <div className="text-2xl font-black text-slate-600">{sinMatch.length.toLocaleString()}</div>
                            <div className="text-xs font-bold text-slate-500">Sin Coincidencia</div>
                            <div className="text-xs text-slate-400">No encontrado en catálogo interno</div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Filtros */}
            <div className="bg-white border-b border-slate-200 px-8 flex gap-1 py-2">
                {[
                    { key: 'propuestos', label: `Propuestas (${propuestos.length.toLocaleString()})`, color: 'amber' },
                    { key: 'aceptados', label: `Vinculados (${yaVinculados.length.toLocaleString()})`, color: 'emerald' },
                    { key: 'sin_match', label: `Sin coincidencia (${sinMatch.length.toLocaleString()})`, color: 'slate' },
                ].map(tab => (
                    <Link
                        key={tab.key}
                        href={`/precios/${encodeURIComponent(proveedorDecoded)}/historial/${importacionId}/vinculacion?filtro=${tab.key}`}
                        className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                            filtro === tab.key
                                ? 'bg-indigo-600 text-white'
                                : 'text-slate-600 hover:bg-slate-100'
                        }`}
                    >
                        {tab.label}
                    </Link>
                ))}
            </div>

            {/* Tabla */}
            <div className="px-8 py-6">
                {filtro === 'propuestos' && propuestos.length === 0 && (
                    <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
                        No hay propuestas pendientes de confirmación.
                    </div>
                )}

                {paginada.length > 0 && (
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-slate-50">
                                    <tr className="text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                                        <th className="py-3 px-4 text-left">SKU Proveedor / Descripción</th>
                                        <th className="py-3 px-4 text-left">Código de Barras</th>
                                        <th className="py-3 px-4 text-right">Dist.</th>
                                        <th className="py-3 px-4 text-right">Menudeo</th>
                                        {filtro !== 'sin_match' && <th className="py-3 px-4 text-left">Artículo en tu Catálogo</th>}
                                        {filtro !== 'sin_match' && <th className="py-3 px-4 text-center">Tipo Match</th>}
                                        {filtro === 'propuestos' && <th className="py-3 px-4 text-center">Acción</th>}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {paginada.map((item, i) => (
                                        <tr key={i} className="hover:bg-slate-50/50">
                                            <td className="py-2.5 px-4">
                                                <span className="font-mono font-bold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                                                    {item.sku_proveedor}
                                                </span>
                                                <p className="text-slate-500 mt-0.5 line-clamp-1">{item.descripcion}</p>
                                                <p className="text-slate-400 text-[10px]">{item.marca}</p>
                                            </td>
                                            <td className="py-2.5 px-4 font-mono text-slate-600">{item.codigo_barra || '—'}</td>
                                            <td className="py-2.5 px-4 text-right font-semibold text-slate-800">{fmtMx(item.dist)}</td>
                                            <td className="py-2.5 px-4 text-right text-slate-600">{fmtMx(item.menudeo)}</td>
                                            {filtro !== 'sin_match' && (
                                                <td className="py-2.5 px-4">
                                                    {item.articulo_match ? (
                                                        <div>
                                                            <p className="font-semibold text-slate-800 line-clamp-1">
                                                                {item.articulo_match.nombre || item.articulo_match.articulo_id}
                                                            </p>
                                                            {item.articulo_match.sku && (
                                                                <p className="text-slate-400 text-[10px]">SKU: {item.articulo_match.sku}</p>
                                                            )}
                                                        </div>
                                                    ) : '—'}
                                                </td>
                                            )}
                                            {filtro !== 'sin_match' && (
                                                <td className="py-2.5 px-4 text-center">
                                                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                                        item.tipo_match === 'alias_codigo' ? 'bg-emerald-100 text-emerald-700' :
                                                        item.tipo_match === 'alias_modelo' ? 'bg-blue-100 text-blue-700' :
                                                        item.tipo_match === 'catalogo_codigo' ? 'bg-amber-100 text-amber-700' :
                                                        'bg-slate-100 text-slate-500'
                                                    }`}>
                                                        {item.tipo_match === 'alias_codigo' ? 'Código exacto' :
                                                         item.tipo_match === 'alias_modelo' ? 'Marca+Modelo' :
                                                         item.tipo_match === 'catalogo_codigo' ? 'Cód. universal' : 'Sin match'}
                                                    </span>
                                                </td>
                                            )}
                                            {filtro === 'propuestos' && (
                                                <td className="py-2.5 px-4 text-center">
                                                    <VinculacionActions
                                                        proveedor={proveedorDecoded}
                                                        importacionId={importacionId}
                                                        filaNum={item.fila_num}
                                                        codigoExcel={item.codigo_barra}
                                                        modeloExcel={item.sku_proveedor}
                                                        marcaExcel={item.marca}
                                                        articuloId={item.articulo_match?.articulo_id || ''}
                                                    />
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Paginación */}
                        {totalPaginas > 1 && (
                            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
                                <span>Mostrando {page * pageSize + 1}–{Math.min((page + 1) * pageSize, listaActiva.length)} de {listaActiva.length.toLocaleString()}</span>
                                <div className="flex gap-2">
                                    {page > 0 && (
                                        <Link href={`/precios/${encodeURIComponent(proveedorDecoded)}/historial/${importacionId}/vinculacion?filtro=${filtro}&page=${page - 1}`}
                                            className="px-3 py-1.5 bg-slate-100 rounded-lg hover:bg-slate-200 font-medium">← Anterior</Link>
                                    )}
                                    {page < totalPaginas - 1 && (
                                        <Link href={`/precios/${encodeURIComponent(proveedorDecoded)}/historial/${importacionId}/vinculacion?filtro=${filtro}&page=${page + 1}`}
                                            className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium">Siguiente →</Link>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
