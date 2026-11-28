'use client';

import React, { useEffect, useState } from 'react';
import {
    X, RefreshCw, Play, Pause, RotateCcw, ExternalLink,
    CheckCircle2, AlertCircle, Clock, Link2, ShieldAlert, Layers
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface BatchMonitorDrawerProps {
    open: boolean;
    onClose: () => void;
    activeBatchId: string | null;
    onSelectBatchId: (id: string) => void;
    accounts: Array<{ id: string; account_name: string }>;
}

const BATCH_STATUS_LABEL: Record<string, { label: string; tone: string }> = {
    running: { label: 'En ejecución', tone: 'bg-[var(--info)]/15 text-[var(--info)] border-[var(--info)]/30' },
    paused: { label: 'Pausado', tone: 'bg-[var(--warn)]/15 text-[var(--warn)] border-[var(--warn)]/30' },
    paused_auth_error: { label: 'Pausado (error token 401)', tone: 'bg-[var(--err)]/15 text-[var(--err)] border-[var(--err)]/30' },
    completed: { label: 'Completado', tone: 'bg-[var(--ok)]/15 text-[var(--ok)] border-[var(--ok)]/30' },
    cancelled: { label: 'Cancelado', tone: 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]' },
    rolled_back: { label: 'Revertido (Rollback)', tone: 'bg-[var(--err)]/15 text-[var(--err)] border-[var(--err)]/30' },
};

const ITEM_STATUS_UI: Record<string, { label: string; cls: string }> = {
    pending: { label: 'En cola', cls: 'bg-[var(--surface-2)] text-[var(--text-muted)]' },
    processing: { label: 'Publicando…', cls: 'bg-[var(--info)]/15 text-[var(--info)]' },
    completed: { label: 'Completada', cls: 'bg-[var(--ok)]/15 text-[var(--ok)]' },
    waiting_optin: { label: 'Esperando optin', cls: 'bg-[var(--info)]/15 text-[var(--info)]' },
    optin_failed: { label: 'Optin falló (trad. viva)', cls: 'bg-[var(--warn)]/15 text-[var(--warn)]' },
    linked_existing: { label: '409 Vinculada', cls: 'bg-[var(--warn)]/15 text-[var(--warn)]' },
    failed_validation: { label: 'Poison Pill (400/422)', cls: 'bg-[var(--err)]/15 text-[var(--err)]' },
    failed_error: { label: 'Error', cls: 'bg-[var(--err)]/15 text-[var(--err)]' },
    skipped: { label: 'Omitida', cls: 'bg-[var(--surface-2)] text-[var(--text-faint)]' },
    cancelled: { label: 'Cancelada', cls: 'bg-[var(--surface-2)] text-[var(--text-faint)]' },
    paused_rollback: { label: 'Pausada (N1)', cls: 'bg-[var(--warn)]/15 text-[var(--warn)]' },
    rolled_back: { label: 'Cerrada (Rollback)', cls: 'bg-[var(--err)]/15 text-[var(--err)]' },
};

export function BatchMonitorDrawer({
    open,
    onClose,
    activeBatchId,
    onSelectBatchId,
    accounts,
}: BatchMonitorDrawerProps) {
    const [batches, setBatches] = useState<any[]>([]);
    const [batchDetail, setBatchDetail] = useState<any>(null);
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const accountName = (id: string) => accounts.find(a => a.id === id)?.account_name || id;

    async function loadBatchList() {
        try {
            const res = await fetch('/api/catalog/replicar/batch');
            const data = await res.json();
            if (data?.ok) {
                setBatches(data.batches || []);
                if (!activeBatchId && data.batches?.length > 0) {
                    onSelectBatchId(data.batches[0].id);
                }
            }
        } catch { /* silencioso */ }
    }

    async function loadDetail(batchId: string, silent = false) {
        if (!silent) setLoading(true);
        try {
            const res = await fetch(`/api/catalog/replicar/batch/${encodeURIComponent(batchId)}`);
            const data = await res.json();
            if (data?.ok) {
                setBatchDetail(data.batch);
                setItems(data.items || []);
            }
        } catch { /* silencioso */ }
        finally {
            if (!silent) setLoading(false);
        }
    }

    useEffect(() => {
        if (!open) return;
        loadBatchList();
    }, [open]);

    useEffect(() => {
        if (!open || !activeBatchId) return;
        loadDetail(activeBatchId);
    }, [open, activeBatchId]);

    useEffect(() => {
        if (!open || !activeBatchId || batchDetail?.status !== 'running') return;
        const t = setInterval(() => {
            loadDetail(activeBatchId, true);
        }, 3000);
        return () => clearInterval(t);
    }, [open, activeBatchId, batchDetail?.status]);

    async function runBatchAction(action: 'pause_queue' | 'resume_queue' | 'pause_live_listings' | 'rollback_close_and_unlink') {
        if (!activeBatchId) return;
        if (action === 'rollback_close_and_unlink') {
            const ok = window.confirm(
                '¿Revertir completamente este lote?\n\n' +
                'Esto cerrará en MercadoLibre las publicaciones NUEVAS creadas por este lote, respaldará sus mapeos en mapeo_desvinculados_log y las desvinculará del Catálogo.\n' +
                '(Las publicaciones que ya existían antes vía 409 NO se cerrarán.)'
            );
            if (!ok) return;
        }
        setActionLoading(action);
        try {
            const res = await fetch(`/api/catalog/replicar/batch/${encodeURIComponent(activeBatchId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action }),
            });
            const data = await res.json();
            if (!res.ok || !data?.ok) throw new Error(data?.error || 'Error ejecutando acción');
            toast.success('Acción aplicada al lote');
            await Promise.all([loadDetail(activeBatchId), loadBatchList()]);
        } catch (err: any) {
            toast.error(err?.message || 'Error');
        } finally {
            setActionLoading(null);
        }
    }

    if (!open) return null;

    const total = Number(batchDetail?.total_items || items.length || 0);
    const doneTotal = batchDetail
        ? Number(batchDetail.completed_count || 0)
            + Number(batchDetail.waiting_optin_count || 0)
            + Number(batchDetail.linked_existing_count || 0)
            + Number(batchDetail.failed_count || 0)
            + Number(batchDetail.skipped_count || 0)
        : 0;
    const pct = total > 0 ? Math.min(100, Math.round((doneTotal / total) * 100)) : 0;
    const stCfg = BATCH_STATUS_LABEL[batchDetail?.status || ''] || {
        label: batchDetail?.status || '—',
        tone: 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]',
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex justify-end" onClick={onClose}>
            <div
                className="w-full max-w-3xl bg-[var(--surface)] h-full border-l border-[var(--border)] flex flex-col shadow-2xl"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-5 py-3.5 border-b border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text)] flex items-center gap-2">
                            <Layers className="w-4 h-4 text-[var(--accent)]" /> Monitor de Lotes de Replicación
                        </h2>
                        <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
                            Seguimiento asíncrono en tiempo real y rollback reversible
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => activeBatchId && loadDetail(activeBatchId)}
                            className="p-1.5 rounded-lg hover:bg-[var(--surface)] text-[var(--text-muted)]"
                            title="Refrescar"
                        >
                            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-1.5 rounded-lg hover:bg-[var(--surface)] text-[var(--text-muted)]"
                            title="Cerrar"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Selector de lote */}
                <div className="px-5 py-2.5 border-b border-[var(--border)] bg-[var(--bg)] flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-bold uppercase text-[var(--text-faint)]">Lote:</span>
                    <select
                        value={activeBatchId || ''}
                        onChange={e => onSelectBatchId(e.target.value)}
                        className="flex-1 min-w-[220px] px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--surface)] font-mono"
                    >
                        {batches.length === 0 && <option value="">Sin lotes recientes</option>}
                        {batches.map(b => (
                            <option key={b.id} value={b.id}>
                                {new Date(b.created_at).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                {' · '}
                                {b.source_account_name} → {b.target_account_name} ({b.total_items}) [{b.status}]
                            </option>
                        ))}
                    </select>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {!batchDetail ? (
                        <div className="py-16 text-center text-sm text-[var(--text-faint)]">
                            {loading ? 'Cargando detalle del lote…' : 'Selecciona o ejecuta un lote para ver su progreso.'}
                        </div>
                    ) : (
                        <>
                            {/* Resumen y barra de progreso */}
                            <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <p className="text-xs font-bold text-[var(--text)]">
                                            {accountName(batchDetail.source_marketplace_id)} → {accountName(batchDetail.target_marketplace_id)}
                                        </p>
                                        <p className="text-[10px] font-mono text-[var(--text-faint)]">ID: {batchDetail.id}</p>
                                    </div>
                                    <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full border', stCfg.tone)}>
                                        {stCfg.label}
                                    </span>
                                </div>

                                {batchDetail.status === 'paused_auth_error' && (
                                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-[var(--err)]/10 border border-[var(--err)]/30 text-xs text-[var(--err)]">
                                        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                                        <span>El lote se detuvo por error de autenticación/token (401/403). Reautoriza la cuenta en /settings y pulsa &quot;Reanudar Cola&quot;.</span>
                                    </div>
                                )}

                                <div className="space-y-1">
                                    <div className="flex justify-between text-[11px] font-semibold">
                                        <span className="text-[var(--text-muted)]">Progreso del lote</span>
                                        <span className="font-mono text-[var(--text)]">{doneTotal} / {total} ({pct}%)</span>
                                    </div>
                                    <div className="w-full h-2.5 bg-[var(--surface)] rounded-full overflow-hidden border border-[var(--border)]">
                                        <div
                                            className="h-full bg-[var(--accent)] transition-all duration-300"
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
                                    <div className="p-2 rounded-lg bg-[var(--ok)]/10 border border-[var(--ok)]/20">
                                        <div className="text-sm font-bold text-[var(--ok)]">{batchDetail.completed_count || 0}</div>
                                        <div className="text-[10px] text-[var(--text-muted)]">Exitosas</div>
                                    </div>
                                    <div className="p-2 rounded-lg bg-[var(--info)]/10 border border-[var(--info)]/20">
                                        <div className="text-sm font-bold text-[var(--info)]">{batchDetail.waiting_optin_count || 0}</div>
                                        <div className="text-[10px] text-[var(--text-muted)]">Esp. Optin</div>
                                    </div>
                                    <div className="p-2 rounded-lg bg-[var(--warn)]/10 border border-[var(--warn)]/20">
                                        <div className="text-sm font-bold text-[var(--warn)]">{batchDetail.linked_existing_count || 0}</div>
                                        <div className="text-[10px] text-[var(--text-muted)]">409 Vinculadas</div>
                                    </div>
                                    <div className="p-2 rounded-lg bg-[var(--err)]/10 border border-[var(--err)]/20">
                                        <div className="text-sm font-bold text-[var(--err)]">{batchDetail.failed_count || 0}</div>
                                        <div className="text-[10px] text-[var(--text-muted)]">Errores</div>
                                    </div>
                                    <div className="p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                                        <div className="text-sm font-bold text-[var(--text-muted)]">{batchDetail.skipped_count || 0}</div>
                                        <div className="text-[10px] text-[var(--text-faint)]">Omit./Rollb.</div>
                                    </div>
                                </div>

                                {/* Acciones de control y rollback */}
                                <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--border)]">
                                    {batchDetail.status === 'running' ? (
                                        <button
                                            type="button"
                                            disabled={!!actionLoading}
                                            onClick={() => runBatchAction('pause_queue')}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 text-[var(--warn)] hover:bg-[var(--warn)]/20 disabled:opacity-50"
                                        >
                                            <Pause className="w-3.5 h-3.5" /> Pausar Cola
                                        </button>
                                    ) : (batchDetail.status === 'paused' || batchDetail.status === 'paused_auth_error') && (
                                        <button
                                            type="button"
                                            disabled={!!actionLoading}
                                            onClick={() => runBatchAction('resume_queue')}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-[var(--ok)]/40 bg-[var(--ok)]/10 text-[var(--ok)] hover:bg-[var(--ok)]/20 disabled:opacity-50"
                                        >
                                            <Play className="w-3.5 h-3.5" /> Reanudar Cola
                                        </button>
                                    )}

                                    <button
                                        type="button"
                                        disabled={!!actionLoading || batchDetail.status === 'rolled_back'}
                                        onClick={() => runBatchAction('pause_live_listings')}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--bg)] disabled:opacity-50"
                                    >
                                        <Pause className="w-3.5 h-3.5" /> Pausar Publicaciones (Nivel 1)
                                    </button>

                                    <button
                                        type="button"
                                        disabled={!!actionLoading || batchDetail.status === 'rolled_back'}
                                        onClick={() => runBatchAction('rollback_close_and_unlink')}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-[var(--err)]/40 bg-[var(--err)]/10 text-[var(--err)] hover:bg-[var(--err)]/20 disabled:opacity-50 ml-auto"
                                    >
                                        <RotateCcw className="w-3.5 h-3.5" />
                                        {actionLoading === 'rollback_close_and_unlink' ? 'Revirtiendo…' : 'Revertir y Cerrar Lote (Nivel 2)'}
                                    </button>
                                </div>
                            </div>

                            {/* Tabla por ítem */}
                            <div className="border border-[var(--border)] rounded-xl overflow-hidden">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-[var(--surface-2)] text-[var(--text-muted)] border-b border-[var(--border)]">
                                        <tr>
                                            <th className="px-3 py-2 font-bold uppercase text-[10px]">Origen</th>
                                            <th className="px-3 py-2 font-bold uppercase text-[10px]">Destino</th>
                                            <th className="px-3 py-2 font-bold uppercase text-[10px]">Estado / Detalle</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[var(--border)]">
                                        {items.map((it: any) => {
                                            const ui = ITEM_STATUS_UI[it.status] || { label: it.status, cls: 'bg-[var(--surface-2)] text-[var(--text-muted)]' };
                                            return (
                                                <tr key={it.id} className="hover:bg-[var(--bg)]/60">
                                                    <td className="px-3 py-2.5 align-top max-w-[220px]">
                                                        <p className="font-mono text-[10px] text-[var(--text-faint)]">{it.source_item_id}</p>
                                                        <p className="font-medium text-[var(--text)] line-clamp-2">{it.source_title || '—'}</p>
                                                        {it.articulo_id && (
                                                            <p className="font-mono text-[10px] text-[var(--accent)] mt-0.5">{it.articulo_id} (×{it.cantidad_requerida})</p>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2.5 align-top">
                                                        {it.target_item_id ? (
                                                            <div className="space-y-0.5">
                                                                <a
                                                                    href={`https://articulo.mercadolibre.com.mx/${String(it.target_item_id).replace(/^(MLM)(\d+)$/, '$1-$2')}`}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    className="inline-flex items-center gap-1 font-mono font-bold text-[var(--accent)] hover:underline"
                                                                >
                                                                    {it.target_item_id} <ExternalLink className="w-3 h-3" />
                                                                </a>
                                                                {it.target_catalog_item_id && (
                                                                    <p className="font-mono text-[10px] text-[var(--ok)]">Cat: {it.target_catalog_item_id}</p>
                                                                )}
                                                                {it.applied_price != null && (
                                                                    <p className="text-[10px] text-[var(--text-muted)]">${Number(it.applied_price).toLocaleString('es-MX')}</p>
                                                                )}
                                                                {it.applied_title && (
                                                                    <p className="text-[10px] text-[var(--text-faint)] truncate max-w-[200px]" title={it.applied_title}>{it.applied_title}</p>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <span className="text-[var(--text-faint)]">—</span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2.5 align-top">
                                                        <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold', ui.cls)}>
                                                            {ui.label}
                                                        </span>
                                                        {it.error_message && (
                                                            <p className="text-[10px] text-[var(--text-muted)] mt-1 break-words leading-snug max-w-[260px]">
                                                                {it.error_message}
                                                            </p>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
