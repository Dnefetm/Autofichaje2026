import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, TrendingDown, Plus, Minus, Minus as Equal } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function ResumenLotePage(props: {
    params: Promise<{ proveedor: string; importacion_id: string }>;
}) {
    const params = await props.params;
    const proveedorDecoded = decodeURIComponent(params.proveedor);
    const importacionId = params.importacion_id;

    // Datos de esta importación
    const { data: imp } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, nombre_archivo, creado_el, total_filas, estado')
        .eq('id', importacionId)
        .single();

    // Filas de ESTA lista (nueva)
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

    // Importación anterior del mismo proveedor (para comparar)
    const { data: anterior } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, nombre_archivo, creado_el')
        .eq('proveedor', proveedorDecoded)
        .eq('estado', 'completado')
        .neq('id', importacionId)
        .order('creado_el', { ascending: false })
        .limit(1);

    let allRawAnterior: any[] = [];
    const anteriorId = anterior?.[0]?.id;

    if (anteriorId) {
        let fromA = 0;
        while (true) {
            const { data: chunk } = await supabaseAdmin
                .from('listas_precios_raw')
                .select('fila_num, payload')
                .eq('importacion_id', anteriorId)
                .range(fromA, fromA + 999);
            if (!chunk || chunk.length === 0) break;
            allRawAnterior = allRawAnterior.concat(chunk);
            if (chunk.length < 1000) break;
            fromA += 1000;
        }
    }

    // Construir mapa de precios por SKU de la lista anterior
    const preciosAnteriores = new Map<string, any>();
    allRawAnterior.forEach(r => {
        const p = r.payload || {};
        const sku = p['CLAVE'] || p['CÓDIGO'] || p['Codigo'] || '';
        if (sku) {
            preciosAnteriores.set(sku, {
                distribuidor: parseFloat(p['P.DIST (CON IVA)'] || p['P.DIST'] || '0') || 0,
                subdistribuidor: parseFloat(p['PRECIO SUBDISTRIBUIDOR (CON IVA)'] || '0') || 0,
                mayoreo: parseFloat(p['PRECIO MAYORE (CON IVA)'] || '0') || 0,
                menudeo: parseFloat(p['PRECIO MENUDEO (CON IVA)'] || '0') || 0,
                descripcion: p['DESCRIPCIÓN LARGA'] || p['DESCRIPCION'] || '',
            });
        }
    });

    // Clasificar cada SKU de la lista nueva
    const actualizados: any[] = [];
    const nuevos: any[] = [];
    const sinCambio: any[] = [];
    const descontinuadosSkus = new Set(preciosAnteriores.keys());

    const fmtMx = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

    allRaw.forEach(r => {
        const p = r.payload || {};
        const sku = p['CLAVE'] || p['CÓDIGO'] || p['Codigo'] || '';
        if (!sku) return;

        descontinuadosSkus.delete(sku); // Si aparece en la nueva, NO está descontinuado

        const dist = parseFloat(p['P.DIST (CON IVA)'] || p['P.DIST'] || '0') || 0;
        const subdist = parseFloat(p['PRECIO SUBDISTRIBUIDOR (CON IVA)'] || '0') || 0;
        const mayoreo = parseFloat(p['PRECIO MAYORE (CON IVA)'] || '0') || 0;
        const menudeo = parseFloat(p['PRECIO MENUDEO (CON IVA)'] || '0') || 0;
        const descripcion = p['DESCRIPCIÓN LARGA'] || p['DESCRIPCION'] || '';
        const marca = p['MARCA'] || p['Marca'] || '';

        const anterior2 = preciosAnteriores.get(sku);

        if (!anterior2) {
            // SKU nunca visto antes = Nuevo
            nuevos.push({ sku, descripcion, marca, dist, subdist, mayoreo, menudeo });
        } else {
            const cambioDist = Math.abs(dist - anterior2.distribuidor) > 0.01;
            const cambioSubdist = Math.abs(subdist - anterior2.subdistribuidor) > 0.01;
            const cambioMayoreo = Math.abs(mayoreo - anterior2.mayoreo) > 0.01;
            const cambioMenudeo = Math.abs(menudeo - anterior2.menudeo) > 0.01;

            if (cambioDist || cambioSubdist || cambioMayoreo || cambioMenudeo) {
                actualizados.push({
                    sku, descripcion, marca,
                    anterior: anterior2,
                    nuevo: { dist, subdist, mayoreo, menudeo }
                });
            } else {
                sinCambio.push({ sku, descripcion, marca, dist, subdist, mayoreo, menudeo });
            }
        }
    });

    // Descontinuados: SKUs de lista anterior que no aparecen en la nueva
    const descontinuados = Array.from(descontinuadosSkus).map(sku => ({
        sku,
        ...preciosAnteriores.get(sku)
    }));

    const hasPrevious = anteriorId != null;

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 px-8 py-5">
                <Link
                    href={`/precios/${encodeURIComponent(proveedorDecoded)}/historial`}
                    className="inline-flex items-center text-sm text-slate-500 hover:text-indigo-600 mb-3"
                >
                    <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Historial
                </Link>
                <h1 className="text-2xl font-bold text-slate-900">
                    Resumen del Lote
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                    {imp?.nombre_archivo} · {imp?.total_filas?.toLocaleString()} productos ·{' '}
                    {imp?.creado_el ? new Date(imp.creado_el).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
                </p>
                {!hasPrevious && (
                    <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg inline-block">
                        No hay lista anterior confirmada de este proveedor para comparar. Se muestra el catálogo completo como nuevo.
                    </div>
                )}
            </header>

            {/* Tarjetas de Resumen */}
            <div className="px-8 py-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                    <div className="text-3xl font-black text-amber-700">{actualizados.length.toLocaleString()}</div>
                    <div className="text-sm font-bold text-amber-600 mt-1 flex items-center gap-1">
                        <TrendingUp className="w-4 h-4" /> Precio Actualizado
                    </div>
                    <div className="text-xs text-amber-500 mt-0.5">Mismo SKU, precio diferente</div>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
                    <div className="text-3xl font-black text-emerald-700">{nuevos.length.toLocaleString()}</div>
                    <div className="text-sm font-bold text-emerald-600 mt-1 flex items-center gap-1">
                        <Plus className="w-4 h-4" /> Nuevos
                    </div>
                    <div className="text-xs text-emerald-500 mt-0.5">SKU no existía antes</div>
                </div>
                <div className="bg-slate-100 border border-slate-200 rounded-2xl p-5">
                    <div className="text-3xl font-black text-slate-600">{sinCambio.length.toLocaleString()}</div>
                    <div className="text-sm font-bold text-slate-500 mt-1">Sin Cambio</div>
                    <div className="text-xs text-slate-400 mt-0.5">Mismo precio que antes</div>
                </div>
                <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5">
                    <div className="text-3xl font-black text-rose-700">{descontinuados.length.toLocaleString()}</div>
                    <div className="text-sm font-bold text-rose-600 mt-1 flex items-center gap-1">
                        <Minus className="w-4 h-4" /> Descontinuados
                    </div>
                    <div className="text-xs text-rose-500 mt-0.5">En lista anterior, ausentes ahora</div>
                </div>
            </div>

            {/* Tabla de Actualizados */}
            {actualizados.length > 0 && (
                <section className="px-8 pb-8">
                    <h2 className="text-base font-bold text-slate-800 mb-3 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-amber-600" />
                        Precios Actualizados ({actualizados.length.toLocaleString()})
                    </h2>
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                        <div className="overflow-x-auto max-h-96 overflow-y-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-slate-50 sticky top-0">
                                    <tr className="text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                                        <th className="py-3 px-4 text-left min-w-[180px]">SKU / Descripción</th>
                                        <th className="py-3 px-4 text-right">Dist. Anterior</th>
                                        <th className="py-3 px-4 text-right">Dist. Nuevo</th>
                                        <th className="py-3 px-4 text-right">Subdist. Ant.</th>
                                        <th className="py-3 px-4 text-right">Subdist. Nuevo</th>
                                        <th className="py-3 px-4 text-right">Mayor. Ant.</th>
                                        <th className="py-3 px-4 text-right">Mayor. Nuevo</th>
                                        <th className="py-3 px-4 text-right">Menu. Ant.</th>
                                        <th className="py-3 px-4 text-right">Menu. Nuevo</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {actualizados.slice(0, 500).map((item, i) => (
                                        <tr key={i} className="hover:bg-amber-50/30">
                                            <td className="py-2.5 px-4">
                                                <span className="font-mono font-bold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded">{item.sku}</span>
                                                <p className="text-slate-500 mt-0.5 line-clamp-1">{item.descripcion}</p>
                                            </td>
                                            <td className="py-2.5 px-4 text-right text-slate-400 line-through">{item.anterior.distribuidor > 0 ? fmtMx(item.anterior.distribuidor) : '—'}</td>
                                            <td className="py-2.5 px-4 text-right font-bold text-slate-900">{item.nuevo.dist > 0 ? fmtMx(item.nuevo.dist) : '—'}</td>
                                            <td className="py-2.5 px-4 text-right text-slate-400 line-through">{item.anterior.subdistribuidor > 0 ? fmtMx(item.anterior.subdistribuidor) : '—'}</td>
                                            <td className="py-2.5 px-4 text-right font-bold text-slate-900">{item.nuevo.subdist > 0 ? fmtMx(item.nuevo.subdist) : '—'}</td>
                                            <td className="py-2.5 px-4 text-right text-slate-400 line-through">{item.anterior.mayoreo > 0 ? fmtMx(item.anterior.mayoreo) : '—'}</td>
                                            <td className="py-2.5 px-4 text-right font-bold text-slate-900">{item.nuevo.mayoreo > 0 ? fmtMx(item.nuevo.mayoreo) : '—'}</td>
                                            <td className="py-2.5 px-4 text-right text-slate-400 line-through">{item.anterior.menudeo > 0 ? fmtMx(item.anterior.menudeo) : '—'}</td>
                                            <td className="py-2.5 px-4 text-right font-bold text-slate-900">{item.nuevo.menudeo > 0 ? fmtMx(item.nuevo.menudeo) : '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
            )}

            {/* Tabla de Descontinuados */}
            {descontinuados.length > 0 && (
                <section className="px-8 pb-8">
                    <h2 className="text-base font-bold text-slate-800 mb-3 flex items-center gap-2">
                        <Minus className="w-4 h-4 text-rose-500" />
                        Descontinuados / Ausentes ({descontinuados.length.toLocaleString()})
                    </h2>
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                        <div className="overflow-x-auto max-h-72 overflow-y-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-slate-50 sticky top-0">
                                    <tr className="text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                                        <th className="py-3 px-4 text-left">SKU / Descripción</th>
                                        <th className="py-3 px-4 text-right">Último Dist.</th>
                                        <th className="py-3 px-4 text-right">Último Menudeo</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {descontinuados.slice(0, 200).map((item, i) => (
                                        <tr key={i} className="hover:bg-rose-50/30 opacity-70">
                                            <td className="py-2.5 px-4">
                                                <span className="font-mono font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">{item.sku}</span>
                                                <p className="text-slate-400 mt-0.5 line-clamp-1">{item.descripcion}</p>
                                            </td>
                                            <td className="py-2.5 px-4 text-right text-slate-500">{item.distribuidor > 0 ? fmtMx(item.distribuidor) : '—'}</td>
                                            <td className="py-2.5 px-4 text-right text-slate-500">{item.menudeo > 0 ? fmtMx(item.menudeo) : '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
            )}
        </div>
    );
}
