import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, Plus, Minus } from 'lucide-react';
import { ActivarListaButton } from '@/components/precios/ActivarListaButton';

export const dynamic = 'force-dynamic';

const fmtMx = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

type TierValor = { valor: number; valor_anterior: number | null; delta_pct: number | null };

export default async function ResumenLotePage(props: {
    params: Promise<{ proveedor: string; importacion_id: string }>;
}) {
    const params = await props.params;
    const proveedorDecoded = decodeURIComponent(params.proveedor);
    const importacionId = params.importacion_id;

    const { data: imp } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, nombre_archivo, creado_el, total_filas, estado, resumen_diff')
        .eq('id', importacionId)
        .single();

    // Mundo 1: la clasificación ya está materializada en precios_proveedor
    // (calculada con las columnas mapeadas, no con nombres fijos de Urrea).
    const { data: filas } = await supabaseAdmin
        .from('precios_proveedor')
        .select('sku_proveedor, marca, descripcion, tipo_costo, valor, valor_anterior, delta_pct, estado')
        .eq('importacion_id', importacionId)
        .eq('vigente', true);

    // Descontinuados: filas de la lista anterior marcadas descontinuado
    const { data: anterior } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id')
        .eq('proveedor', proveedorDecoded)
        .eq('estado', 'completado')
        .neq('id', importacionId)
        .order('creado_el', { ascending: false })
        .limit(1);
    const prevId = anterior?.[0]?.id;

    const { data: descontinuadosRows } = prevId
        ? await supabaseAdmin
            .from('precios_proveedor')
            .select('sku_proveedor, marca, descripcion, tipo_costo, valor')
            .eq('importacion_id', prevId)
            .eq('estado', 'descontinuado')
        : { data: [] as any[] };

    // Agrupar por sku
    const skuMap = new Map<string, { sku: string; marca: string; descripcion: string; estado: string; tiers: Record<string, TierValor> }>();
    for (const r of filas || []) {
        const sku = r.sku_proveedor;
        if (!sku) continue;
        if (!skuMap.has(sku)) {
            skuMap.set(sku, { sku, marca: r.marca || '', descripcion: r.descripcion || '', estado: 'sin_cambio', tiers: {} });
        }
        const g = skuMap.get(sku)!;
        g.tiers[(r.tipo_costo || '').toLowerCase()] = {
            valor: Number(r.valor),
            valor_anterior: r.valor_anterior != null ? Number(r.valor_anterior) : null,
            delta_pct: r.delta_pct != null ? Number(r.delta_pct) : null,
        };
        if (r.estado === 'nuevo') g.estado = 'nuevo';
        else if (r.estado === 'actualizado') g.estado = 'actualizado';
    }

    const nuevos: any[] = [];
    const actualizados: any[] = [];
    const sinCambio: any[] = [];
    for (const g of skuMap.values()) {
        if (g.estado === 'nuevo') nuevos.push(g);
        else if (g.estado === 'actualizado') actualizados.push(g);
        else sinCambio.push(g);
    }

    // Descontinuados agrupados por sku
    const descMap = new Map<string, any>();
    for (const r of descontinuadosRows || []) {
        const sku = r.sku_proveedor;
        if (!sku) continue;
        if (!descMap.has(sku)) descMap.set(sku, { sku, marca: r.marca || '', descripcion: r.descripcion || '', distribuidor: 0, menudeo: 0 });
        const g = descMap.get(sku);
        const t = (r.tipo_costo || '').toLowerCase();
        if (t === 'distribuidor') g.distribuidor = Number(r.valor);
        if (t === 'menudeo') g.menudeo = Number(r.valor);
    }
    const descontinuados = Array.from(descMap.values());

    const hasPrevious = prevId != null;

    return (
        <div className="min-h-screen bg-[var(--bg)]">
            <header className="bg-[var(--surface)] border-b border-[var(--border)] px-4 py-2">
                <Link
                    href={`/precios/${encodeURIComponent(proveedorDecoded)}/historial`}
                    className="inline-flex items-center text-xs text-[var(--text-muted)] hover:text-[var(--accent)] mb-1"
                >
                    <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Historial
                </Link>
                <div className="flex items-start justify-between gap-3 flex-col lg:flex-row lg:items-center">
                    <div className="min-w-0">
                        <h1 className="text-base font-bold text-[var(--text)] leading-tight">Resumen del Lote</h1>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
                            {imp?.nombre_archivo} · {imp?.total_filas?.toLocaleString()} productos ·{' '}
                            {imp?.creado_el ? new Date(imp.creado_el).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
                        </p>
                        {imp?.estado === 'completado' && (
                            <span className="mt-1 inline-flex items-center text-[11px] font-bold text-[var(--ok)] bg-[var(--ok)]/10 border border-[var(--ok)]/30 px-2 py-0.5 rounded">
                                ● Lista Activa y Vigente
                            </span>
                        )}
                        {!hasPrevious && (
                            <div className="mt-1 text-xs text-[var(--warn)] bg-[var(--warn)]/10 border border-[var(--warn)]/30 px-2 py-1 rounded inline-block">
                                Sin lista anterior para comparar. Todo aparece como Nuevo.
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        {imp?.estado !== 'completado' && (
                            <ActivarListaButton importacionId={importacionId} proveedor={proveedorDecoded} />
                        )}
                        <Link
                            href={`/precios/${encodeURIComponent(proveedorDecoded)}/revisar`}
                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--surface-2)] hover:bg-[var(--bg)] text-[var(--text)] rounded-xl font-bold text-sm transition-colors"
                        >
                            Auditar cambios →
                        </Link>
                        <Link
                            href={`/precios/${encodeURIComponent(proveedorDecoded)}/historial/${importacionId}/vinculacion`}
                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--accent)] hover:brightness-110 text-[var(--accent-ink)] rounded-xl font-bold text-sm transition-colors shadow-sm"
                        >
                            Ver Vinculación con Catálogo →
                        </Link>
                    </div>
                </div>
            </header>

            <div className="px-8 py-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-[var(--warn)]/10 border border-[var(--warn)]/30 rounded-2xl p-5">
                    <div className="text-3xl font-black text-[var(--warn)]">{actualizados.length.toLocaleString()}</div>
                    <div className="text-sm font-bold text-[var(--warn)] mt-1 flex items-center gap-1">
                        <TrendingUp className="w-4 h-4" /> Precio Actualizado
                    </div>
                    <div className="text-xs text-[var(--warn)] mt-0.5">Mismo SKU, precio diferente</div>
                </div>
                <div className="bg-[var(--ok)]/10 border border-[var(--ok)]/30 rounded-2xl p-5">
                    <div className="text-3xl font-black text-[var(--ok)]">{nuevos.length.toLocaleString()}</div>
                    <div className="text-sm font-bold text-[var(--ok)] mt-1 flex items-center gap-1">
                        <Plus className="w-4 h-4" /> Nuevos
                    </div>
                    <div className="text-xs text-[var(--ok)] mt-0.5">SKU no existía antes</div>
                </div>
                <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl p-5">
                    <div className="text-3xl font-black text-[var(--text-muted)]">{sinCambio.length.toLocaleString()}</div>
                    <div className="text-sm font-bold text-[var(--text-muted)] mt-1">Sin Cambio</div>
                    <div className="text-xs text-[var(--text-faint)] mt-0.5">Mismo precio que antes</div>
                </div>
                <div className="bg-[var(--err)]/10 border border-[var(--err)]/30 rounded-2xl p-5">
                    <div className="text-3xl font-black text-[var(--err)]">{descontinuados.length.toLocaleString()}</div>
                    <div className="text-sm font-bold text-[var(--err)] mt-1 flex items-center gap-1">
                        <Minus className="w-4 h-4" /> Descontinuados
                    </div>
                    <div className="text-xs text-[var(--err)] mt-0.5">En lista anterior, ausentes ahora</div>
                </div>
            </div>

            {actualizados.length > 0 && (
                <section className="px-8 pb-8">
                    <h2 className="text-base font-bold text-[var(--text)] mb-3 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-[var(--warn)]" />
                        Precios Actualizados ({actualizados.length.toLocaleString()})
                    </h2>
                    <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden shadow-sm">
                        <div className="overflow-x-auto max-h-96 overflow-y-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-[var(--bg)] sticky top-0">
                                    <tr className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border)]">
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
                                <tbody className="divide-y divide-[var(--border)]">
                                    {actualizados.slice(0, 500).map((g, i) => {
                                        const d = g.tiers.distribuidor;
                                        const s = g.tiers.subdistribuidor;
                                        const m = g.tiers.mayoreo;
                                        const mn = g.tiers.menudeo;
                                        return (
                                            <tr key={i} className="hover:bg-[var(--warn)]/10">
                                                <td className="py-2.5 px-4">
                                                    <span className="font-mono font-bold text-[var(--text)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded">{g.sku}</span>
                                                    <p className="text-[var(--text-muted)] mt-0.5 line-clamp-1">{g.descripcion}</p>
                                                </td>
                                                <td className="py-2.5 px-4 text-right text-[var(--text-faint)] line-through">{d?.valor_anterior != null && d.valor_anterior > 0 ? fmtMx(d.valor_anterior) : '—'}</td>
                                                <td className="py-2.5 px-4 text-right font-bold text-[var(--text)]">{d ? fmtMx(d.valor) : '—'}</td>
                                                <td className="py-2.5 px-4 text-right text-[var(--text-faint)] line-through">{s?.valor_anterior != null && s.valor_anterior > 0 ? fmtMx(s.valor_anterior) : '—'}</td>
                                                <td className="py-2.5 px-4 text-right font-bold text-[var(--text)]">{s ? fmtMx(s.valor) : '—'}</td>
                                                <td className="py-2.5 px-4 text-right text-[var(--text-faint)] line-through">{m?.valor_anterior != null && m.valor_anterior > 0 ? fmtMx(m.valor_anterior) : '—'}</td>
                                                <td className="py-2.5 px-4 text-right font-bold text-[var(--text)]">{m ? fmtMx(m.valor) : '—'}</td>
                                                <td className="py-2.5 px-4 text-right text-[var(--text-faint)] line-through">{mn?.valor_anterior != null && mn.valor_anterior > 0 ? fmtMx(mn.valor_anterior) : '—'}</td>
                                                <td className="py-2.5 px-4 text-right font-bold text-[var(--text)]">{mn ? fmtMx(mn.valor) : '—'}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
            )}

            {descontinuados.length > 0 && (
                <section className="px-8 pb-8">
                    <h2 className="text-base font-bold text-[var(--text)] mb-3 flex items-center gap-2">
                        <Minus className="w-4 h-4 text-[var(--err)]" />
                        Descontinuados / Ausentes ({descontinuados.length.toLocaleString()})
                    </h2>
                    <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden shadow-sm">
                        <div className="overflow-x-auto max-h-72 overflow-y-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-[var(--bg)] sticky top-0">
                                    <tr className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border)]">
                                        <th className="py-3 px-4 text-left">SKU / Descripción</th>
                                        <th className="py-3 px-4 text-right">Último Dist.</th>
                                        <th className="py-3 px-4 text-right">Último Menudeo</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[var(--border)]">
                                    {descontinuados.slice(0, 200).map((item, i) => (
                                        <tr key={i} className="hover:bg-[var(--err)]/10 opacity-70">
                                            <td className="py-2.5 px-4">
                                                <span className="font-mono font-bold text-[var(--text-muted)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded">{item.sku}</span>
                                                <p className="text-[var(--text-faint)] mt-0.5 line-clamp-1">{item.descripcion}</p>
                                            </td>
                                            <td className="py-2.5 px-4 text-right text-[var(--text-muted)]">{item.distribuidor > 0 ? fmtMx(item.distribuidor) : '—'}</td>
                                            <td className="py-2.5 px-4 text-right text-[var(--text-muted)]">{item.menudeo > 0 ? fmtMx(item.menudeo) : '—'}</td>
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
