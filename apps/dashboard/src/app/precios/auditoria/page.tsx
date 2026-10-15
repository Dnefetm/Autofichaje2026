"use client";
import { toast } from 'sonner';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, DollarSign, CheckSquare, Square, AlertCircle, RefreshCw } from 'lucide-react';

export default function AuditoriaPricingPage() {
    const [drafts, setDrafts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [approving, setApproving] = useState(false);

    useEffect(() => {
        loadDrafts();
    }, []);

    const [loadError, setLoadError] = useState<string | null>(null);

    const loadDrafts = async () => {
        setLoading(true);
        setLoadError(null);

        // Paginado explicito: PostgREST devuelve como maximo 1,000 filas. Sin esto la
        // bandeja veia 1,000 de los 6,842 borradores.
        const PAGE = 1000;
        let all: any[] = [];
        for (let from = 0; ; from += PAGE) {
            const { data, error } = await supabase
                .from('publication_pricing_drafts')
                // seller_sku es la columna REAL. sku_fabricante no existe y hacia fallar
                // la consulta completa (400), dejando la bandeja en Todo al dia.
                .select('*, publicacion:publicaciones_externas(id, titulo, precio_venta, seller_sku, seller_custom_field, free_shipping, shipping_cost_monto, sync_disabled, category_id, marketplace:marketplace_configs(account_name))')
                .eq('pricing_review_status', 'pending')
                .range(from, from + PAGE - 1);

            if (error) {
                setLoadError(error.message);
                setDrafts([]);
                setSelected(new Set());
                setLoading(false);
                return;
            }
            all = all.concat(data || []);
            if (!data || data.length < PAGE) break;
        }

        setDrafts(all);
        setSelected(new Set());
        setLoading(false);
    };

    // Un borrador solo es aprobable si el precio sirve y el envio es creible.
    const esAprobable = (d: any) =>
        Number(d.draft_price) > 0 &&
        ['valid', 'estimated_params', 'override_active'].includes(d.pricing_status) &&
        d.publicacion?.sync_disabled !== true &&
        (!d.publicacion?.free_shipping || Number(d.publicacion?.shipping_cost_monto) > 0);

    const toggleSelect = (id: string) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelected(next);
    };

    const toggleAll = () => {
        const aprobables = drafts.filter(esAprobable).map(d => d.publicacion_id);
        if (selected.size === aprobables.length) setSelected(new Set());
        else setSelected(new Set(aprobables));
    };

    const handleApproveSelected = async () => {
        if (selected.size === 0) return;
        setApproving(true);
        try {
            const res = await fetch('/api/pricing/approve-drafts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ publicaciones: Array.from(selected) })
            });
            if (!res.ok) throw new Error('Error al aprobar');
            await loadDrafts();
        } catch (err) {
            console.error(err);
            toast.error('Error aprobando');
        } finally {
            setApproving(false);
        }
    };

    if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[var(--text-faint)]" /></div>;

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--text)] flex items-center gap-2">
                        <DollarSign className="w-6 h-6 text-[var(--accent)]" /> Auditoría de Precios
                    </h1>
                    <p className="text-sm text-[var(--text-muted)]">Publicaciones y combos pendientes de validación ({drafts.length})</p>
                </div>
                <div className="flex gap-3">
                    <button onClick={loadDrafts} className="px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded shadow-sm text-[var(--text-muted)] hover:bg-[var(--bg)] flex items-center gap-2 text-sm font-semibold">
                        <RefreshCw className="w-4 h-4" /> Recargar
                    </button>
                    <button 
                        disabled={selected.size === 0 || approving}
                        onClick={handleApproveSelected}
                        className="px-4 py-2 bg-[var(--accent)] text-[var(--accent-ink)] rounded shadow-sm hover:brightness-110 disabled:opacity-50 flex items-center gap-2 text-sm font-bold"
                    >
                        {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckSquare className="w-4 h-4" />}
                        Aprobar Seleccionados ({selected.size})
                    </button>
                </div>
            </div>

            {loadError && (
                <div className="mb-4 p-4 rounded-xl border border-[var(--err)] bg-[var(--err)]/10 text-[var(--err)] text-sm">
                    <b>No se pudo cargar la bandeja.</b> {loadError}
                    <br />La lista vacia NO significa todo al dia.
                </div>
            )}

            {drafts.length === 0 ? (
                <div className="bg-[var(--surface)] p-10 rounded-xl border border-[var(--border)] text-center text-[var(--text-muted)] flex flex-col items-center">
                    <CheckSquare className="w-10 h-10 text-[var(--ok)] mb-3" />
                    <p className="font-bold text-[var(--text-muted)]">¡Todo al día!</p>
                    <p className="text-sm">No hay precios pendientes de aprobación.</p>
                </div>
            ) : (
                <div className="bg-[var(--surface)] rounded-xl shadow-sm border border-[var(--border)] overflow-hidden">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                            <tr>
                                <th className="px-4 py-3 w-10">
                                    <button onClick={toggleAll}>
                                        {selected.size > 0 && selected.size === drafts.filter(esAprobable).length ? <CheckSquare className="w-4 h-4 text-[var(--accent)]" /> : <Square className="w-4 h-4" />}
                                    </button>
                                </th>
                                <th className="px-4 py-3">Publicación</th>
                                <th className="px-4 py-3">Precio Actual</th>
                                <th className="px-4 py-3 text-[var(--warn)]">Precio Sugerido</th>
                                <th className="px-4 py-3">Variación</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                            {drafts.map(d => {
                                const cur = d.publicacion?.precio_venta || 0;
                                const nxt = d.draft_price;
                                const pct = cur > 0 ? ((nxt - cur) / cur) * 100 : 0;
                                const isUp = pct > 0;
                                return (
                                    <tr key={d.publicacion_id} className="hover:bg-[var(--bg)] transition-colors">
                                        <td className="px-4 py-3">
                                            <button onClick={() => toggleSelect(d.publicacion_id)}>
                                                {selected.has(d.publicacion_id) ? <CheckSquare className="w-4 h-4 text-[var(--accent)]" /> : <Square className="w-4 h-4 text-[var(--text-faint)]" />}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3">
                                            <p className="font-semibold text-[var(--text)] line-clamp-1" title={d.publicacion?.titulo || ""}>{d.publicacion?.titulo || "(Sin título)"}</p>
                                            <p className="text-xs text-[var(--text-muted)]">SKU: {d.publicacion?.seller_sku || d.publicacion?.seller_custom_field || '-'} • {d.publicacion?.marketplace?.account_name || "-"}</p>
                                        </td>
                                        <td className="px-4 py-3 text-[var(--text-muted)] font-medium">{Number(cur) > 0 ? '$' + Number(cur).toFixed(2) : '-'}</td>
                                        <td className="px-4 py-3 font-bold text-[var(--warn)]">{Number(nxt) > 0 ? '$' + Number(nxt).toFixed(2) : 'bloqueado: ' + d.pricing_status}</td>
                                        <td className="px-4 py-3">
                                            {cur > 0 && pct !== 0 ? (
                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-bold">
                                                    {isUp ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}%
                                                </span>
                                            ) : (
                                                <span className="text-[var(--text-faint)] text-xs">-</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

