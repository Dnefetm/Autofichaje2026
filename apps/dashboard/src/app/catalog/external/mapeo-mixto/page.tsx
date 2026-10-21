"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock, Loader2, Link2, RefreshCw, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Articulo { articulo_id: string; nombre: string; caja_madre: string | null; }
interface Caso {
    marketplace_id: string;
    user_product_id: string;
    mapeada: {
        id: string;
        external_item_id: string;
        titulo: string;
        listing_type_id: string;
        status_externo: string;
        articulo_id: string | null;
        cantidad_requerida: number;
        sincronizar_stock: boolean;
        articulo: Articulo | null;
    };
    sin_mapear: Array<{ id: string; external_item_id: string; titulo: string; listing_type_id: string; status_externo: string }>;
}

const listingLabel = ({ gold_special: 'Clásica', gold_pro: 'Premium', free: 'Gratuita', silver: 'Silver' } as any);
const statusLabel = ({ active: 'Activa', paused: 'Pausada', under_review: 'En revisión', closed: 'Cerrada' } as any);

export default function MapeoMixtoPage() {
    const [casos, setCasos] = useState<Caso[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [vinculando, setVinculando] = useState<string | null>(null);
    const [cantidades, setCantidades] = useState<Record<string, string>>({});

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/vinculacion/mapeo-mixto');
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al cargar');
            const casos = (data.casos || []) as Caso[];
            setCasos(casos);
            const init: Record<string, string> = {};
            for (const c of casos) for (const s of c.sin_mapear) init[s.id] = String(c.mapeada.cantidad_requerida ?? 1);
            setCantidades(init);
        } catch (e: any) {
            setError(e.message || 'Error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const vincular = async (sib: any, caso: Caso) => {
        if (!caso.mapeada.articulo_id) { toast.error('La publicación mapeada no tiene artículo enlazado'); return; }
        setVinculando(sib.id);
        try {
            const cantidad = Math.max(1, parseInt(cantidades[sib.id] ?? '') || 1);
            const res = await fetch('/api/vinculacion/confirmar-lote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vinculos: [{
                        publicacion_id: sib.id,
                        articulo_id: caso.mapeada.articulo_id,
                        cantidad_requerida: cantidad,
                        sincronizar_stock: caso.mapeada.sincronizar_stock,
                    }],
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al vincular');
            toast.success(`${sib.external_item_id} vinculada`);
            await load();
        } catch (e: any) {
            toast.error(e.message || 'Error');
        } finally {
            setVinculando(null);
        }
    };

    return (
        <div className="flex-1 overflow-auto bg-[var(--surface-2)] min-h-screen">
            <div className="py-6 max-w-5xl mx-auto space-y-4 px-4">
                <Link href="/catalog/external" className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
                    <ArrowLeft className="w-4 h-4" /> Vitrinas de MeLi
                </Link>

                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <h1 className="text-lg font-bold text-[var(--text)]">Mapeo mixto (condiciones de venta)</h1>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            Publicaciones hermanas (mismo User Product) donde una está mapeada y otra no. Solo tú decides vincular.
                        </p>
                    </div>
                    <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/30 rounded-lg hover:bg-[var(--accent)]/20 disabled:opacity-50">
                        <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} /> Refrescar
                    </button>
                </div>

                {loading ? (
                    <div className="py-20 text-center text-[var(--text-faint)] flex items-center justify-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" /> Cargando…
                    </div>
                ) : error ? (
                    <div className="p-6 bg-[var(--err)]/10 border border-[var(--err)]/30 rounded-[var(--radius)] text-[var(--err)] text-sm flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" /> {error}
                    </div>
                ) : casos.length === 0 ? (
                    <div className="p-12 text-center text-[var(--text-faint)] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)]">
                        <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-[var(--ok)]" />
                        <p className="text-sm">No hay mapeos mixtos pendientes.</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <p className="text-xs text-[var(--text-faint)]">{casos.length} caso(s)</p>
                        {casos.map((caso) => (
                            <div key={`${caso.marketplace_id}::${caso.user_product_id}`} className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] overflow-hidden">
                                {/* Header del caso */}
                                <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between gap-2 flex-wrap">
                                    <span className="text-xs font-mono text-[var(--text-muted)]">{caso.user_product_id}</span>
                                    <span className="text-[10px] text-[var(--text-faint)]">{caso.sin_mapear.length} sin mapear</span>
                                </div>

                                {/* Mapeada (referencia) */}
                                <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-3 flex-wrap">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-[var(--ok)]/10 text-[var(--ok)] border-[var(--ok)]/30">
                                        <CheckCircle2 className="w-3 h-3" /> Mapeada
                                    </span>
                                    <Link href={`/catalog/external/${caso.mapeada.id}`} className="text-sm font-semibold text-[var(--text)] hover:text-[var(--accent)] hover:underline truncate">
                                        {caso.mapeada.external_item_id}
                                    </Link>
                                    <span className="text-[10px] text-[var(--text-muted)]">{listingLabel[caso.mapeada.listing_type_id] || caso.mapeada.listing_type_id || '—'}</span>
                                    <span className="text-[10px] text-[var(--text-muted)]">{statusLabel[caso.mapeada.status_externo] || caso.mapeada.status_externo || '—'}</span>
                                    <span className="text-[10px] font-mono text-[var(--text-faint)] truncate max-w-[40%]">
                                        {caso.mapeada.articulo?.nombre || caso.mapeada.articulo_id || 'sin artículo'}
                                        {caso.mapeada.articulo?.caja_madre ? ` · ${caso.mapeada.articulo.caja_madre}` : ''}
                                    </span>
                                    <span className="text-[10px] font-bold text-[var(--accent)]">×{caso.mapeada.cantidad_requerida}</span>
                                </div>

                                {/* Sin mapear (candidatas) */}
                                <div className="divide-y divide-[var(--border)]">
                                    {caso.sin_mapear.map((sib) => (
                                        <div key={sib.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                                            <div className="min-w-0 flex items-center gap-2 flex-wrap">
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-[var(--err)]/10 text-[var(--err)] border-[var(--err)]/30">
                                                    <AlertCircle className="w-3 h-3" /> Sin mapear
                                                </span>
                                                <Link href={`/catalog/external/${sib.id}`} className="text-sm font-medium text-[var(--text)] hover:text-[var(--accent)] hover:underline truncate">
                                                    {sib.external_item_id}
                                                </Link>
                                                <span className="text-[10px] text-[var(--text-muted)]">{listingLabel[sib.listing_type_id] || sib.listing_type_id || '—'}</span>
                                                <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border",
                                                    sib.status_externo === 'active' ? "bg-[var(--ok)]/10 text-[var(--ok)] border-[var(--ok)]/30"
                                                        : sib.status_externo === 'paused' ? "bg-[var(--warn)]/10 text-[var(--warn)] border-[var(--warn)]/30"
                                                            : "bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]")}>
                                                    {statusLabel[sib.status_externo] || sib.status_externo || '—'}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                                                    <Package className="w-3 h-3" /> piezas
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        value={cantidades[sib.id] ?? String(caso.mapeada.cantidad_requerida ?? 1)}
                                                        onChange={(e) => setCantidades((prev) => ({ ...prev, [sib.id]: e.target.value }))}
                                                        onBlur={() => {
                                                            const sid = sib.id;
                                                            setCantidades((prev) => { const v = prev[sid]; const n = parseInt(v ?? ''); return { ...prev, [sid]: (n && n >= 1) ? String(n) : '1' }; });
                                                        }}
                                                        className="w-14 px-1.5 py-1 text-xs border border-[var(--border)] rounded bg-[var(--surface)] text-[var(--text)] font-mono"
                                                    />
                                                </label>
                                                <button
                                                    onClick={() => vincular(sib, caso)}
                                                    disabled={vinculando === sib.id}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-[var(--accent-ink)] bg-[var(--accent)] rounded-[var(--radius-sm)] hover:brightness-110 disabled:opacity-50"
                                                >
                                                    {vinculando === sib.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                                                    Vincular
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
