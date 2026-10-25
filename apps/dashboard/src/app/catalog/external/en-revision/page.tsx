"use client";

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import {
    ArrowLeft, AlertTriangle, ExternalLink, Download, Search,
    RefreshCw, ShieldAlert, Package, CheckCircle2, ChevronLeft, ChevronRight, Sliders
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';
import { Btn } from '@/components/ui/Btn';
import { Card } from '@/components/ui/Card';
import { Page } from '@/components/ui/Page';

interface EnRevisionItem {
    id: string;
    external_item_id: string;
    titulo: string;
    precio_venta: number | null;
    seller_custom_field: string | null;
    seller_sku: string | null;
    brand: string | null;
    url_imagen: string | null;
    permalink: string | null;
    status_externo: string;
    sub_status: string[] | null;
    tipo_publicacion: string | null;
    par_item_id: string | null;
    stock_publicado: number | null;
    sync_disabled: boolean;
    sync_disabled_reason: string | null;
    logistic_type: string | null;
    esta_mapeado: boolean;
    actualizado_el: string | null;
}

const PAGE_SIZE = 50;

function formatCurrency(n: number | null | undefined): string {
    if (n === null || n === undefined) return '—';
    return `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function subStatusLabel(code: string): { label: string; color: string; desc: string } {
    switch (code) {
        case 'forbidden':
            return {
                label: '⛔ Bloqueada (Forbidden)',
                color: 'bg-[var(--err)]/15 text-[var(--err)] border-[var(--err)]/30',
                desc: 'MeLi congeló la publicación por infracción, precio o revisión manual de seguridad'
            };
        case 'waiting_for_patch':
            return {
                label: '⚠️ Esperando Corrección',
                color: 'bg-[var(--warn)]/15 text-[var(--warn)] border-[var(--warn)]/30',
                desc: 'Requiere actualizar atributos, ficha técnica o fotos en MeLi'
            };
        case 'invalid_kit':
            return {
                label: '📦 Kit Inválido',
                color: 'bg-purple-500/15 text-purple-700 border-purple-500/30',
                desc: 'Configuración de combo o paquete no aceptada por MeLi'
            };
        case 'pending_documentation':
            return {
                label: '📄 Falta Documentación',
                color: 'bg-blue-500/15 text-blue-700 border-blue-500/30',
                desc: 'MeLi solicita facturas o documentación del producto'
            };
        case 'deleted':
            return {
                label: '🗑️ Eliminada',
                color: 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]',
                desc: 'Publicación dada de baja definitivamente'
            };
        case 'out_of_stock':
            return {
                label: 'Sin Stock',
                color: 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]',
                desc: 'Publicación pausada por stock en 0'
            };
        default:
            return {
                label: code,
                color: 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]',
                desc: code
            };
    }
}

function EnRevisionInner() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [items, setItems] = useState<EnRevisionItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [totalCount, setTotalCount] = useState(0);
    const [page, setPage] = useState(1);
    const [searchTerm, setSearchTerm] = useState(searchParams.get('q') || '');
    const [debouncedSearch, setDebouncedSearch] = useState(searchParams.get('q') || '');
    const [filterCause, setFilterCause] = useState<string>(searchParams.get('causa') || 'all');
    const [filterTipo, setFilterTipo] = useState<string>(searchParams.get('tipo') || 'all');

    // Debounce buscador
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSearch(searchTerm);
            setPage(1);
        }, 300);
        return () => clearTimeout(handler);
    }, [searchTerm]);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('publicaciones_externas')
                .select('*', { count: 'exact' })
                .or('status_externo.eq.under_review,sub_status.cs.{"forbidden"},sync_disabled.eq.true');

            // Filtro por causa
            if (filterCause === 'forbidden') {
                query = query.filter('sub_status', 'cs', '{"forbidden"}');
            } else if (filterCause === 'waiting_for_patch') {
                query = query.filter('sub_status', 'cs', '{"waiting_for_patch"}');
            } else if (filterCause === 'pending_docs') {
                query = query.filter('sub_status', 'cs', '{"pending_documentation"}');
            } else if (filterCause === 'sync_off') {
                query = query.eq('sync_disabled', true);
            }

            // Filtro por tipo de publicación
            if (filterTipo === 'catalogo') {
                query = query.in('tipo_publicacion', ['catalogo', 'catalogo_derivada']);
            } else if (filterTipo === 'tradicional') {
                query = query.eq('tipo_publicacion', 'tradicional');
            }

            // Buscador
            if (debouncedSearch.trim()) {
                const s = debouncedSearch.trim();
                query = query.or(`titulo.ilike.%${s}%,external_item_id.ilike.%${s}%,seller_custom_field.ilike.%${s}%,seller_sku.ilike.%${s}%`);
            }

            // Paginación en servidor
            const from = (page - 1) * PAGE_SIZE;
            const to = from + PAGE_SIZE - 1;
            query = query.order('status_externo', { ascending: true }).order('actualizado_el', { ascending: false }).range(from, to);

            const { data, count, error } = await query;
            if (error) throw error;

            setItems((data as EnRevisionItem[]) || []);
            setTotalCount(count || 0);
        } catch (e: any) {
            console.error('Error cargando publicaciones en revisión:', e);
            toast.error(e.message || 'Error al cargar publicaciones');
        } finally {
            setLoading(false);
        }
    }, [page, debouncedSearch, filterCause, filterTipo]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Exportar a CSV con causas señaladas y permalinks directos
    const handleExportCSV = async () => {
        try {
            toast.loading('Generando CSV de publicaciones con problemas...');
            let query = supabase
                .from('publicaciones_externas')
                .select('external_item_id, titulo, tipo_publicacion, par_item_id, status_externo, sub_status, precio_venta, stock_publicado, seller_custom_field, seller_sku, permalink, sync_disabled_reason')
                .or('status_externo.eq.under_review,sub_status.cs.{"forbidden"},sync_disabled.eq.true')
                .order('status_externo', { ascending: true });

            if (filterCause === 'forbidden') {
                query = query.filter('sub_status', 'cs', '{"forbidden"}');
            }

            const { data, error } = await query;
            if (error) throw error;
            if (!data || data.length === 0) {
                toast.dismiss();
                toast.info('No hay publicaciones para exportar con estos filtros');
                return;
            }

            const headers = ['ID MeLi', 'Título', 'Tipo', 'Par Tradicional', 'Estado', 'Causas (Sub-Status)', 'Precio', 'Stock', 'SKU', 'Razón Bloqueo Sync', 'Enlace MeLi'];
            const rows = data.map((d: any) => [
                d.external_item_id,
                `"${(d.titulo || '').replace(/"/g, '""')}"`,
                d.tipo_publicacion || 'tradicional',
                d.par_item_id || '—',
                d.status_externo,
                `"${(Array.isArray(d.sub_status) ? d.sub_status.join(', ') : '')}"`,
                d.precio_venta || 0,
                d.stock_publicado ?? 0,
                `"${d.seller_custom_field || d.seller_sku || ''}"`,
                `"${(d.sync_disabled_reason || '').replace(/"/g, '""')}"`,
                d.permalink || `https://articulo.mercadolibre.com.mx/${d.external_item_id}`
            ]);

            const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `publicaciones_en_revision_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast.dismiss();
            toast.success(`Exportadas ${data.length} publicaciones correctamente`);
        } catch (e: any) {
            toast.dismiss();
            toast.error('Error al exportar CSV: ' + e.message);
        }
    };

    const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;

    return (
        <div className="flex-1 overflow-auto bg-[var(--bg)] min-h-screen">
            <Page>
                {/* Cabecera */}
                <div className="mb-2">
                    <Link
                        href="/catalog/external"
                        className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] font-medium transition-colors"
                    >
                        <ArrowLeft className="w-3.5 h-3.5" /> Volver a Vitrinas
                    </Link>
                </div>

                <PageHeader
                    title="Vitrinas En Revisión y Bloqueadas en MeLi"
                    description={`${totalCount.toLocaleString()} publicaciones requieren atención o revisión directa en Mercado Libre`}
                    actions={
                        <div className="flex items-center gap-2">
                            <Btn
                                variant="outline"
                                onClick={handleExportCSV}
                                icon={<Download className="w-4 h-4 text-[var(--accent)]" />}
                            >
                                Exportar CSV
                            </Btn>
                            <Btn
                                variant="ghost"
                                onClick={() => loadData()}
                                disabled={loading}
                                loading={loading}
                                icon={<RefreshCw className="w-4 h-4" />}
                            >
                                Refrescar
                            </Btn>
                        </div>
                    }
                />

                {/* Filtros Rápidos por Causa */}
                <div className="flex flex-wrap items-center gap-2 mb-4">
                    <button
                        onClick={() => { setFilterCause('all'); setPage(1); }}
                        className={cn("px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors",
                            filterCause === 'all'
                                ? "bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)]"
                                : "bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:bg-[var(--surface-2)]"
                        )}
                    >
                        Todas las Afectadas
                    </button>
                    <button
                        onClick={() => { setFilterCause('forbidden'); setPage(1); }}
                        className={cn("px-3 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-colors",
                            filterCause === 'forbidden'
                                ? "bg-[var(--err)] text-white border-[var(--err)]"
                                : "bg-[var(--surface)] text-[var(--err)] border-[var(--err)]/30 hover:bg-[var(--err)]/10"
                        )}
                    >
                        <ShieldAlert className="w-3.5 h-3.5" /> ⛔ Bloqueadas (Forbidden)
                    </button>
                    <button
                        onClick={() => { setFilterCause('waiting_for_patch'); setPage(1); }}
                        className={cn("px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors",
                            filterCause === 'waiting_for_patch'
                                ? "bg-[var(--warn)] text-white border-[var(--warn)]"
                                : "bg-[var(--surface)] text-[var(--warn)] border-[var(--warn)]/30 hover:bg-[var(--warn)]/10"
                        )}
                    >
                        Esperando Patch
                    </button>
                    <button
                        onClick={() => { setFilterCause('pending_docs'); setPage(1); }}
                        className={cn("px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors",
                            filterCause === 'pending_docs'
                                ? "bg-blue-600 text-white border-blue-600"
                                : "bg-[var(--surface)] text-blue-600 border-blue-500/30 hover:bg-blue-500/10"
                        )}
                    >
                        Falta Documentación
                    </button>

                    {/* Filtro por tipo */}
                    <div className="ml-auto flex items-center gap-2">
                        <select
                            value={filterTipo}
                            onChange={e => { setFilterTipo(e.target.value); setPage(1); }}
                            className="text-xs bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 font-medium text-[var(--text)]"
                        >
                            <option value="all">Todos los Tipos</option>
                            <option value="tradicional">Solo Tradicionales</option>
                            <option value="catalogo">Solo Catálogo</option>
                        </select>
                    </div>
                </div>

                {/* Buscador */}
                <div className="relative mb-4">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                    <input
                        type="text"
                        placeholder="Buscar por título, MLM, SKU..."
                        className="w-full pl-9 pr-4 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl text-xs text-[var(--text)] placeholder:text-[var(--text-faint)] shadow-sm"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>

                {/* Tabla de Publicaciones */}
                <Card className="overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-[var(--surface-2)] text-[var(--text-muted)] border-b border-[var(--border)]">
                                <tr>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Publicación</th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Tipo / Vínculo</th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Causa Señalada en MeLi</th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right">Precio</th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right">Stock</th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right">Acción MeLi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                                {loading ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center text-[var(--text-faint)]">
                                            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[var(--accent)]" />
                                            Cargando publicaciones afectadas...
                                        </td>
                                    </tr>
                                ) : items.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center text-[var(--text-faint)]">
                                            No hay publicaciones en revisión o bloqueadas con estos filtros.
                                        </td>
                                    </tr>
                                ) : (
                                    items.map(item => {
                                        const sku = item.seller_custom_field || item.seller_sku;
                                        const subStatuses = Array.isArray(item.sub_status) ? item.sub_status : [];
                                        const meliUrl = item.permalink || `https://articulo.mercadolibre.com.mx/${item.external_item_id}`;

                                        return (
                                            <tr key={item.id} className="hover:bg-[var(--surface-2)]/60 transition-colors">
                                                {/* 1. PUBLICACION */}
                                                <td className="px-4 py-3 align-top max-w-sm">
                                                    <div className="flex items-start gap-3">
                                                        {item.url_imagen ? (
                                                            <img
                                                                src={item.url_imagen}
                                                                alt=""
                                                                className="w-10 h-10 rounded-lg object-cover border border-[var(--border)] shrink-0"
                                                            />
                                                        ) : (
                                                            <div className="w-10 h-10 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center shrink-0">
                                                                <Package className="w-4 h-4 text-[var(--text-faint)]" />
                                                            </div>
                                                        )}
                                                        <div className="min-w-0">
                                                            <Link
                                                                href={`/catalog/external/${item.id}`}
                                                                className="text-xs font-semibold text-[var(--text)] hover:text-[var(--accent)] line-clamp-2 leading-snug"
                                                            >
                                                                {item.titulo}
                                                            </Link>
                                                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                                                <span className="text-[10px] font-mono text-[var(--text-faint)] font-bold">{item.external_item_id}</span>
                                                                {sku && (
                                                                    <span className="text-[10px] font-mono bg-[var(--surface-2)] text-[var(--text-muted)] px-1 rounded">
                                                                        SKU: {sku}
                                                                    </span>
                                                                )}
                                                                {item.brand && (
                                                                    <span className="text-[10px] text-[var(--text-muted)] font-medium">
                                                                        {item.brand}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* 2. TIPO */}
                                                <td className="px-4 py-3 align-top">
                                                    <div className="flex flex-col gap-1 items-start">
                                                        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                                                            item.tipo_publicacion === 'catalogo' || item.tipo_publicacion === 'catalogo_derivada'
                                                                ? "bg-purple-500/15 text-purple-700"
                                                                : "bg-[var(--surface-2)] text-[var(--text-muted)]"
                                                        )}>
                                                            {item.tipo_publicacion || 'tradicional'}
                                                        </span>
                                                        {item.par_item_id && (
                                                            <span className="text-[10px] text-[var(--text-faint)] font-mono" title="Publicación tradicional vinculada">
                                                                Par: {item.par_item_id}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* 3. CAUSAS SEÑALADAS EN MELI */}
                                                <td className="px-4 py-3 align-top">
                                                    <div className="flex flex-col gap-1 items-start max-w-xs">
                                                        {subStatuses.length > 0 ? (
                                                            subStatuses.map(s => {
                                                                const info = subStatusLabel(s);
                                                                return (
                                                                    <span
                                                                        key={s}
                                                                        className={cn("inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border", info.color)}
                                                                        title={info.desc}
                                                                    >
                                                                        {info.label}
                                                                    </span>
                                                                );
                                                            })
                                                        ) : (
                                                            <span className="text-[10px] text-[var(--warn)] font-semibold">
                                                                En revisión general
                                                            </span>
                                                        )}
                                                        {item.sync_disabled && (
                                                            <span className="text-[10px] text-[var(--err)] font-bold bg-[var(--err)]/10 px-1 rounded mt-0.5" title={item.sync_disabled_reason || ''}>
                                                                Sync off: {item.sync_disabled_reason ? item.sync_disabled_reason.slice(0, 45) + '...' : 'Bloqueado'}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* 4. PRECIO */}
                                                <td className="px-4 py-3 align-top text-right font-mono text-xs font-bold text-[var(--text)]">
                                                    {formatCurrency(item.precio_venta)}
                                                </td>

                                                {/* 5. STOCK */}
                                                <td className="px-4 py-3 align-top text-right font-mono text-xs text-[var(--text-muted)]">
                                                    {item.stock_publicado ?? 0}
                                                </td>

                                                {/* 6. ACCIÓN DIRECTA */}
                                                <td className="px-4 py-3 align-top text-right">
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        <a
                                                            href={meliUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-[var(--accent-ink)] bg-[var(--accent)] hover:brightness-110 rounded shadow-sm transition-all"
                                                            title="Abrir en Mercado Libre para resolver revisión"
                                                        >
                                                            <span>Atender en MeLi</span>
                                                            <ExternalLink className="w-3 h-3" />
                                                        </a>
                                                        <Link
                                                            href={`/catalog/external/${item.id}`}
                                                            className="p-1 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                                                            title="Ver detalle interno"
                                                        >
                                                            <Sliders className="w-4 h-4" />
                                                        </Link>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Paginación */}
                    <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--surface)] flex items-center justify-between">
                        <span className="text-xs text-[var(--text-muted)]">
                            Mostrando {items.length} de {totalCount.toLocaleString()} publicaciones afectadas
                        </span>
                        <div className="flex items-center gap-2">
                            <Btn
                                variant="ghost"
                                size="sm"
                                disabled={page <= 1 || loading}
                                onClick={() => setPage(p => p - 1)}
                                icon={<ChevronLeft className="w-4 h-4" />}
                            >
                                Anterior
                            </Btn>
                            <span className="text-xs font-semibold text-[var(--text)]">
                                {page} / {totalPages}
                            </span>
                            <Btn
                                variant="ghost"
                                size="sm"
                                disabled={page >= totalPages || loading}
                                onClick={() => setPage(p => p + 1)}
                                icon={<ChevronRight className="w-4 h-4" />}
                            >
                                Siguiente
                            </Btn>
                        </div>
                    </div>
                </Card>
            </Page>
        </div>
    );
}

export default function EnRevisionPage() {
    return (
        <Suspense fallback={
            <div className="flex-1 flex items-center justify-center min-h-screen">
                <RefreshCw className="w-8 h-8 animate-spin text-[var(--accent)]" />
            </div>
        }>
            <EnRevisionInner />
        </Suspense>
    );
}
