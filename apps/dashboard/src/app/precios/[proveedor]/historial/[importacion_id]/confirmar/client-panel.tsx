'use client';
import { toast } from 'sonner';

import { useState } from 'react';
import { CheckSquare, ArrowUpRight, ArrowDownRight, Check, Loader2, Sparkles, Filter } from 'lucide-react';
import { useRouter } from 'next/navigation';

export interface CostoItem {
    id: string;
    articulo_id: string;
    modelo_excel: string;
    marca_excel: string;
    codigo_universal_excel: string;
    descripcion_excel: string;
    tipo_costo: string;
    valor: number;
    moneda: string;
    valor_anterior: number | null;
    delta_pct: number | null;
    delta_val: number | null;
}

export interface ProductoAgrupado {
    key: string;
    articulo_id: string;
    modelo: string;
    marca: string;
    codigo: string;
    descripcion: string;
    precios: {
        tipo_costo: string;
        valor: number;
        valor_anterior: number | null;
        delta_pct: number | null;
        delta_val: number | null;
        id: string;
    }[];
    tiene_cambio: boolean;
}

export function PriceConfirmationPanelClient({
    importacionId,
    proveedor,
    costos = [],
    ausentes = []
}: {
    importacionId: string;
    proveedor: string;
    costos: CostoItem[];
    ausentes?: any[];
}) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [filtro, setFiltro] = useState<'todos' | 'con_cambio' | 'nuevos'>('todos');
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

    // Agrupar los 4 tipos de costo en 1 sola fila por producto
    const productosMap = new Map<string, ProductoAgrupado>();

    (costos || []).forEach(c => {
        const prodKey = `${c.articulo_id || ''}-${c.modelo_excel || ''}-${c.codigo_universal_excel || ''}`;
        if (!productosMap.has(prodKey)) {
            productosMap.set(prodKey, {
                key: prodKey,
                articulo_id: c.articulo_id,
                modelo: c.modelo_excel,
                marca: c.marca_excel,
                codigo: c.codigo_universal_excel,
                descripcion: c.descripcion_excel,
                precios: [],
                tiene_cambio: false
            });
        }

        const prod = productosMap.get(prodKey)!;
        const tieneVariacion = c.valor_anterior !== null && c.valor !== c.valor_anterior;
        if (tieneVariacion) prod.tiene_cambio = true;

        prod.precios.push({
            tipo_costo: c.tipo_costo,
            valor: c.valor,
            valor_anterior: c.valor_anterior,
            delta_pct: c.delta_pct,
            delta_val: c.delta_val,
            id: c.id
        });
    });

    const productos = Array.from(productosMap.values());

    const productosFiltrados = productos.filter(p => {
        if (filtro === 'con_cambio') return p.tiene_cambio;
        if (filtro === 'nuevos') return p.precios.some(pr => pr.valor_anterior === null);
        return true;
    });

    const fmtMx = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedKeys(new Set(productosFiltrados.map(p => p.key)));
        } else {
            setSelectedKeys(new Set());
        }
    };

    const handleSelectOne = (key: string, checked: boolean) => {
        const next = new Set(selectedKeys);
        if (checked) next.add(key);
        else next.delete(key);
        setSelectedKeys(next);
    };

    const handleConfirmar = async (soloSeleccionados: boolean = false) => {
        setLoading(true);
        try {
            // Extraer todos los IDs de costos que se van a confirmar
            let idsToConfirm: string[] = [];
            if (soloSeleccionados) {
                productos
                    .filter(p => selectedKeys.has(p.key))
                    .forEach(p => p.precios.forEach(pr => idsToConfirm.push(pr.id)));
            } else {
                costos.forEach(c => idsToConfirm.push(c.id));
            }

            const res = await fetch('/api/precios/confirmar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    importacion_id: importacionId,
                    proveedor,
                    modo: soloSeleccionados ? 'individual' : 'todos',
                    ids: soloSeleccionados ? idsToConfirm : null
                })
            });

            if (!res.ok) throw new Error('Error al confirmar precios');

            toast.success('¡Precios actualizados y vigentes con éxito!');
            router.push(`/precios/${encodeURIComponent(proveedor)}`);
        } catch (e: any) {
            toast.error(e.message || 'Error al confirmar');
        } finally {
            setLoading(false);
        }
    };

    const tiposCostoOrden = ['distribuidor', 'subdistribuidor', 'mayoreo', 'menudeo'];

    return (
        <div className="bg-[var(--surface)] rounded-2xl shadow-sm border border-[var(--border)] overflow-hidden">
            {/* Header del Panel */}
            <div className="p-6 border-b border-[var(--border)] bg-[var(--bg)]/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-[var(--text)] flex items-center gap-2">
                        <CheckSquare className="w-5 h-5 text-[var(--accent)]" />
                        Revisión de Precios: {proveedor}
                    </h2>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                        {productos.length} productos coincidentes · {costos.length} costos calculados
                    </p>
                </div>

                {/* Acciones principales */}
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => {
                            if (!confirm(`¿Confirmas aprobar los ${productos.length} productos? Se actualizarán sus precios y quedarán vigentes.`)) return;
                            handleConfirmar(false);
                        }}
                        disabled={loading || productos.length === 0}
                        className="px-5 py-2.5 bg-[var(--ok)] hover:brightness-110 text-[var(--accent-ink)] rounded-xl text-sm font-bold shadow-sm transition-all flex items-center gap-2 disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Aprobar Todos ({productos.length})
                    </button>
                    {selectedKeys.size > 0 && (
                        <button
                            onClick={() => handleConfirmar(true)}
                            disabled={loading}
                            className="px-4 py-2.5 bg-[var(--accent)] hover:brightness-110 text-[var(--accent-ink)] rounded-xl text-sm font-bold shadow-sm transition-all flex items-center gap-2"
                        >
                            Aprobar Selección ({selectedKeys.size})
                        </button>
                    )}
                </div>
            </div>

            {/* Barra de Filtros */}
            <div className="px-6 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                    <Filter className="w-3.5 h-3.5 text-[var(--text-faint)]" />
                    <span className="font-bold text-[var(--text-muted)]">Filtrar:</span>
                    <button
                        onClick={() => setFiltro('todos')}
                        className={`px-3 py-1 rounded-lg font-medium transition-colors ${filtro === 'todos' ? 'bg-[var(--accent)]/10 text-[var(--accent)] font-bold' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                    >
                        Todos ({productos.length})
                    </button>
                    <button
                        onClick={() => setFiltro('con_cambio')}
                        className={`px-3 py-1 rounded-lg font-medium transition-colors ${filtro === 'con_cambio' ? 'bg-[var(--warn)]/10 text-[var(--warn)] font-bold' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                    >
                        Con Variación de Precio
                    </button>
                    <button
                        onClick={() => setFiltro('nuevos')}
                        className={`px-3 py-1 rounded-lg font-medium transition-colors ${filtro === 'nuevos' ? 'bg-[var(--ok)]/10 text-[var(--ok)] font-bold' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                    >
                        Nuevos
                    </button>
                </div>

                <span className="text-[var(--text-faint)]">
                    Mostrando {productosFiltrados.length} productos
                </span>
            </div>

            {/* Mobile: tarjetas apiladas (sin scroll horizontal) */}
            <div className="md:hidden divide-y divide-[var(--border)]">
                {productosFiltrados.length === 0 ? (
                    <div className="py-12 text-center text-[var(--text-faint)] text-sm">No hay productos para mostrar.</div>
                ) : (
                    productosFiltrados.map(prod => {
                        const checked = selectedKeys.has(prod.key);
                        return (
                            <div key={prod.key} className="p-4 space-y-2.5">
                                <div className="flex items-start gap-3">
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={e => handleSelectOne(prod.key, e.target.checked)}
                                        className="mt-0.5 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-mono font-bold text-[var(--text)] bg-[var(--surface-2)] px-2 py-0.5 rounded text-[11px]">{prod.modelo || prod.codigo}</span>
                                            <span className="text-[var(--text-muted)] font-semibold text-xs">{prod.marca}</span>
                                        </div>
                                        <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-1" title={prod.descripcion}>{prod.descripcion}</p>
                                        <span className="text-[10px] text-[var(--text-faint)] font-mono">ID Catálogo: {prod.articulo_id}</span>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    {tiposCostoOrden.map(tipo => {
                                        const pInfo = prod.precios.find(pr => pr.tipo_costo?.toLowerCase() === tipo);
                                        const label = tipo.charAt(0).toUpperCase() + tipo.slice(1);
                                        if (!pInfo) {
                                            return (
                                                <div key={tipo} className="text-xs border border-[var(--border)] rounded-lg p-2">
                                                    <div className="text-[var(--text-faint)]">{label}</div>
                                                    <div className="text-[var(--text-faint)]">—</div>
                                                </div>
                                            );
                                        }
                                        const tienePrevio = pInfo.valor_anterior !== null;
                                        const subio = pInfo.delta_val !== null && pInfo.delta_val > 0;
                                        const bajo = pInfo.delta_val !== null && pInfo.delta_val < 0;
                                        return (
                                            <div key={tipo} className="text-xs border border-[var(--border)] rounded-lg p-2">
                                                <div className="text-[var(--text-faint)]">{label}</div>
                                                {tienePrevio && <div className="text-[var(--text-faint)] line-through">{fmtMx.format(pInfo.valor_anterior!)}</div>}
                                                <div className="font-bold text-[var(--text)] flex items-center gap-1 flex-wrap">
                                                    {fmtMx.format(pInfo.valor)}
                                                    {subio && (
                                                        <span className="text-[10px] font-bold text-[var(--err)] bg-[var(--err)]/10 px-1 py-0.5 rounded flex items-center">
                                                            <ArrowUpRight className="w-3 h-3" />+{pInfo.delta_pct?.toFixed(1)}%
                                                        </span>
                                                    )}
                                                    {bajo && (
                                                        <span className="text-[10px] font-bold text-[var(--ok)] bg-[var(--ok)]/10 px-1 py-0.5 rounded flex items-center">
                                                            <ArrowDownRight className="w-3 h-3" />{pInfo.delta_pct?.toFixed(1)}%
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Desktop: tabla (1 FILA POR PRODUCTO CON COMPARATIVA EN 2 RENGLONES) */}
            <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-[var(--bg)]/80 border-b border-[var(--border)] text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                            <th className="py-3 px-4 w-10">
                                <input
                                    type="checkbox"
                                    onChange={e => handleSelectAll(e.target.checked)}
                                    checked={selectedKeys.size === productosFiltrados.length && productosFiltrados.length > 0}
                                    className="rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]"
                                />
                            </th>
                            <th className="py-3 px-4 min-w-[220px]">Producto / Catálogo</th>
                            <th className="py-3 px-4 text-right">Distribuidor</th>
                            <th className="py-3 px-4 text-right">Subdistribuidor</th>
                            <th className="py-3 px-4 text-right">Mayoreo</th>
                            <th className="py-3 px-4 text-right">Menudeo</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)] text-xs">
                        {productosFiltrados.map(prod => (
                            <tr key={prod.key} className="hover:bg-[var(--bg)]/60 transition-colors group">
                                {/* Checkbox */}
                                <td className="py-3.5 px-4 align-top pt-4">
                                    <input
                                        type="checkbox"
                                        checked={selectedKeys.has(prod.key)}
                                        onChange={e => handleSelectOne(prod.key, e.target.checked)}
                                        className="rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]"
                                    />
                                </td>

                                {/* Producto y Detalles */}
                                <td className="py-3.5 px-4 align-top">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono font-bold text-[var(--text)] bg-[var(--surface-2)] px-2 py-0.5 rounded text-[11px]">
                                            {prod.modelo || prod.codigo}
                                        </span>
                                        <span className="text-[var(--text-muted)] font-semibold">{prod.marca}</span>
                                    </div>
                                    <p className="text-[var(--text-muted)] mt-1 line-clamp-1 text-xs" title={prod.descripcion}>
                                        {prod.descripcion}
                                    </p>
                                    <span className="text-[10px] text-[var(--text-faint)] font-mono">
                                        ID Catálogo: {prod.articulo_id}
                                    </span>
                                </td>

                                {/* 4 Columnas de Precios (Distribuidor, Subdist, Mayoreo, Menudeo) */}
                                {tiposCostoOrden.map(tipo => {
                                    const pInfo = prod.precios.find(pr => pr.tipo_costo?.toLowerCase() === tipo);
                                    if (!pInfo) {
                                        return (
                                            <td key={tipo} className="py-3.5 px-4 text-right align-top text-[var(--text-faint)]">
                                                —
                                            </td>
                                        );
                                    }

                                    const tienePrevio = pInfo.valor_anterior !== null;
                                    const subio = pInfo.delta_val !== null && pInfo.delta_val > 0;
                                    const bajo = pInfo.delta_val !== null && pInfo.delta_val < 0;

                                    return (
                                        <td key={tipo} className="py-3 px-4 text-right align-top">
                                            {/* Renglón 1: Precio Previo */}
                                            <div className="text-[11px] text-[var(--text-faint)]">
                                                {tienePrevio ? fmtMx.format(pInfo.valor_anterior!) : <span className="italic text-[var(--text-faint)]">Previo: —</span>}
                                            </div>

                                            {/* Renglón 2: Precio Nuevo + Variación */}
                                            <div className="font-bold text-[var(--text)] text-sm mt-0.5 flex items-center justify-end gap-1">
                                                {fmtMx.format(pInfo.valor)}
                                                {subio && (
                                                    <span className="text-[10px] font-bold text-[var(--err)] bg-[var(--err)]/10 px-1 py-0.5 rounded flex items-center">
                                                        <ArrowUpRight className="w-3 h-3" />
                                                        +{pInfo.delta_pct?.toFixed(1)}%
                                                    </span>
                                                )}
                                                {bajo && (
                                                    <span className="text-[10px] font-bold text-[var(--ok)] bg-[var(--ok)]/10 px-1 py-0.5 rounded flex items-center">
                                                        <ArrowDownRight className="w-3 h-3" />
                                                        {pInfo.delta_pct?.toFixed(1)}%
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
