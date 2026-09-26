'use client';

import { useState } from 'react';
import { Link as LinkIcon, Check, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { VincularArticuloModal } from './VincularArticuloModal';

// Columnas de precio dinámicas (tipos de costo libres por proveedor).
export interface TierCol {
    key: string;   // clave normalizada (lowercase/trim)
    label: string; // etiqueta visible
}

export interface HubItem {
    id: string;
    sku: string;                          // sku_proveedor (modelo/clave del proveedor)
    codigo: string;                       // EAN, si se conoce vía alias
    marca: string;
    descripcion: string;
    tiers: Record<string, number | null>; // tipo_costo normalizado -> valor vigente
    articulo_id_vinculado: string | null;
}

export function CatalogoProveedorTable({
    proveedor,
    items = [],
    tiers = [],
}: {
    proveedor: string;
    items: HubItem[];
    tiers: TierCol[];
}) {
    const [selectedItem, setSelectedItem] = useState<HubItem | null>(null);
    const [localVinculados, setLocalVinculados] = useState<Set<string>>(new Set());
    const [page, setPage] = useState(0);
    const ITEMS_PER_PAGE = 50;

    const fmtMx = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
    const fmt = (n: number | null | undefined) => (n != null ? fmtMx.format(n) : '—');

    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    const paginatedItems = items.slice(page * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE + ITEMS_PER_PAGE);

    const openVincular = (item: HubItem) => setSelectedItem(item);

    return (
        <div className="bg-[var(--surface)] rounded-2xl shadow-sm border border-[var(--border)] overflow-hidden">
            {/* Paginación Superior */}
            {totalPages > 1 && (
                <div className="px-4 py-3 bg-[var(--bg)] border-b border-[var(--border)] flex items-center justify-between">
                    <span className="text-xs text-[var(--text-muted)] font-medium">
                        Mostrando {page * ITEMS_PER_PAGE + 1} - {Math.min((page + 1) * ITEMS_PER_PAGE, items.length)} de {items.length} artículos
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setPage(p => Math.max(0, p - 1))}
                            disabled={page === 0}
                            className="p-1.5 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] disabled:opacity-50 hover:bg-[var(--bg)]"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-xs font-bold text-[var(--text-muted)] px-2">Pág {page + 1} de {totalPages}</span>
                        <button
                            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                            disabled={page === totalPages - 1}
                            className="p-1.5 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] disabled:opacity-50 hover:bg-[var(--bg)]"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}

            {/* Mobile: tarjetas apiladas */}
            <div className="md:hidden divide-y divide-[var(--border)]">
                {paginatedItems.length === 0 ? (
                    <div className="py-12 text-center text-[var(--text-faint)] text-sm">No hay productos para mostrar.</div>
                ) : (
                    paginatedItems.map(item => {
                        const vinculado = !!item.articulo_id_vinculado || localVinculados.has(item.id);
                        return (
                            <div key={item.id} className="p-4 space-y-2.5">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="font-mono font-bold text-[var(--text)] bg-[var(--surface-2)] px-2 py-0.5 rounded text-[11px]">{item.sku}</span>
                                            <span className="text-[var(--text-faint)] text-[10px]">{item.marca}</span>
                                        </div>
                                        {item.codigo && item.codigo !== item.sku && (
                                            <div className="text-[10px] text-[var(--text-faint)] font-mono mt-0.5">EAN: {item.codigo}</div>
                                        )}
                                    </div>
                                    {vinculado ? (
                                        <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-[var(--ok)]/10 text-[var(--ok)] border border-[var(--ok)]/30"><Check className="w-3 h-3" /> Vinculado</span>
                                    ) : (
                                        <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--surface-2)] text-[var(--text-muted)]">No vinculado</span>
                                    )}
                                </div>
                                {item.descripcion && <p className="text-xs text-[var(--text-muted)] line-clamp-2">{item.descripcion}</p>}
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                                    {tiers.map(t => (
                                        <div key={t.key} className="flex justify-between">
                                            <span className="text-[var(--text-faint)]">{t.label}</span>
                                            <span className="font-bold text-[var(--text)]">{fmt(item.tiers[t.key])}</span>
                                        </div>
                                    ))}
                                </div>
                                <button
                                    onClick={() => openVincular(item)}
                                    className={`w-full px-3 py-2 rounded-xl text-xs font-bold transition-all inline-flex items-center justify-center gap-1 ${vinculado ? 'bg-[var(--surface-2)] hover:bg-[var(--bg)] text-[var(--text-muted)]' : 'bg-[var(--accent)] hover:brightness-110 text-[var(--accent-ink)]'}`}
                                >
                                    {vinculado ? <><LinkIcon className="w-3 h-3" /> Cambiar</> : <><Plus className="w-3 h-3" /> Vincular</>}
                                </button>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Desktop: tabla */}
            <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-[var(--bg)]/80 border-b border-[var(--border)] text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                            <th className="py-3.5 px-4 min-w-[200px]">Código / Modelo</th>
                            <th className="py-3.5 px-4 min-w-[260px]">Descripción</th>
                            {tiers.map(t => (
                                <th key={t.key} className="py-3.5 px-4 text-right whitespace-nowrap">{t.label}</th>
                            ))}
                            <th className="py-3.5 px-4 text-center">Estado Catálogo</th>
                            <th className="py-3.5 px-4 text-right">Acción</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)] text-xs">
                        {paginatedItems.length === 0 ? (
                            <tr>
                                <td colSpan={4 + tiers.length} className="py-12 text-center text-[var(--text-faint)] text-sm">
                                    No hay productos para mostrar.
                                </td>
                            </tr>
                        ) : (
                            paginatedItems.map(item => {
                                const vinculado = !!item.articulo_id_vinculado || localVinculados.has(item.id);
                                return (
                                    <tr key={item.id} className="hover:bg-[var(--bg)]/60 transition-colors group">
                                        <td className="py-3.5 px-4 align-top">
                                            <div className="flex items-center gap-1.5">
                                                <span className="font-mono font-bold text-[var(--text)] bg-[var(--surface-2)] px-2 py-0.5 rounded text-[11px]">
                                                    {item.sku}
                                                </span>
                                                <span className="text-[var(--text-faint)] text-[10px]">{item.marca}</span>
                                            </div>
                                            {item.codigo && item.codigo !== item.sku && (
                                                <div className="text-[10px] text-[var(--text-faint)] font-mono mt-0.5">
                                                    EAN: {item.codigo}
                                                </div>
                                            )}
                                        </td>
                                        <td className="py-3.5 px-4 align-top text-[var(--text-muted)]">
                                            <p className="line-clamp-2" title={item.descripcion}>
                                                {item.descripcion || '—'}
                                            </p>
                                        </td>
                                        {tiers.map(t => (
                                            <td key={t.key} className="py-3.5 px-4 text-right align-top font-bold text-[var(--text)]">
                                                {fmt(item.tiers[t.key])}
                                            </td>
                                        ))}
                                        <td className="py-3.5 px-4 text-center align-top">
                                            {vinculado ? (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-[var(--ok)]/10 text-[var(--ok)] border border-[var(--ok)]/30">
                                                    <Check className="w-3 h-3" /> Vinculado
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--surface-2)] text-[var(--text-muted)]">
                                                    No vinculado
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-3.5 px-4 text-right align-top">
                                            <button
                                                onClick={() => openVincular(item)}
                                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1 shadow-sm ${vinculado ? 'bg-[var(--surface-2)] hover:bg-[var(--bg)] text-[var(--text-muted)]' : 'bg-[var(--accent)] hover:brightness-110 text-[var(--accent-ink)]'}`}
                                            >
                                                {vinculado ? (
                                                    <><LinkIcon className="w-3 h-3" /> Cambiar</>
                                                ) : (
                                                    <><Plus className="w-3 h-3" /> Vincular</>
                                                )}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Paginación Inferior */}
            {totalPages > 1 && (
                <div className="px-4 py-3 bg-[var(--bg)] border-t border-[var(--border)] flex items-center justify-between">
                    <span className="text-xs text-[var(--text-muted)] font-medium">
                        Página {page + 1} de {totalPages}
                    </span>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1.5 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] disabled:opacity-50 font-bold text-xs">Anterior</button>
                        <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1} className="px-3 py-1.5 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] disabled:opacity-50 font-bold text-xs">Siguiente</button>
                    </div>
                </div>
            )}

            {selectedItem && (
                <VincularArticuloModal
                    proveedor={proveedor}
                    itemProveedor={{
                        codigo: selectedItem.codigo || '',
                        modelo: selectedItem.sku || '',
                        marca: selectedItem.marca || '',
                        descripcion: selectedItem.descripcion || '',
                        precio_distribuidor: selectedItem.tiers['distribuidor'] ?? null,
                    }}
                    onClose={() => setSelectedItem(null)}
                    onSuccess={() => {
                        setLocalVinculados(prev => new Set([...prev, selectedItem.id]));
                        setSelectedItem(null);
                    }}
                />
            )}
        </div>
    );
}
