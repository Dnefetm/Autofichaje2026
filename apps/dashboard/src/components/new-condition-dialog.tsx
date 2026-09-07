"use client";

import { useState } from 'react';
import { X, Layers, CheckCircle2, AlertCircle, ExternalLink, RefreshCw, Truck, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

const LISTING_TYPES = [
    { id: 'gold_special', label: 'Clásica', desc: 'Exposición estándar · sin envío gratis' },
    { id: 'gold_pro', label: 'Premium', desc: 'Mayor exposición · permite envío gratis' },
] as const;

function listingLabel(id: string | null | undefined) {
    return (LISTING_TYPES.find(t => t.id === id)?.label) || id || '—';
}

interface Props {
    accountId: string;
    itemId: string;
    itemTitle: string;
    currentListingType: string;
    currentFreeShipping: boolean;
    currentPrice: number;
    articuloId: string;
    onClose: () => void;
    onDone: (data: any) => void;
}

export function NewConditionDialog({
    accountId,
    itemId,
    itemTitle,
    currentListingType,
    currentFreeShipping,
    currentPrice,
    articuloId,
    onClose,
    onDone,
}: Props) {
    const [listingType, setListingType] = useState<string>(
        currentListingType === 'gold_pro' ? 'gold_special' : 'gold_pro',
    );
    const [freeShipping, setFreeShipping] = useState<boolean>(!currentFreeShipping);
    const [price, setPrice] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    async function submit(dryRun: boolean) {
        setLoading(true);
        setError(null);
        setResult(null);
        try {
            const res = await fetch('/api/publish/new-condition', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    marketplace_id: accountId,
                    item_id: itemId,
                    listing_type_id: listingType,
                    free_shipping: freeShipping,
                    price_override: price.trim() ? Number(price) : null,
                    articulo_id: articuloId,
                    dry_run: dryRun,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
                const msg = data.error || data.meli_error?.message || 'Error desconocido';
                setError(msg);
            } else {
                setResult(data);
                if (!dryRun) onDone(data);
            }
        } catch (e: any) {
            setError(e.message || 'Error de red');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
            <div
                className="w-full max-w-md bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] shadow-xl animate-in fade-in duration-150"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
                    <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-[var(--accent)]" />
                        <h3 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">Nueva condición de venta</h3>
                    </div>
                    <button onClick={onClose} className="p-1 text-[var(--text-faint)] hover:text-[var(--text)] transition-colors" title="Cerrar">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {/* Ítem de origen */}
                    <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--surface-2)] border border-[var(--border)]">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)]">Se derivará de</p>
                        <p className="text-sm font-semibold text-[var(--text)] mt-1 truncate">{itemTitle || itemId}</p>
                        <p className="text-[11px] text-[var(--text-muted)] mt-1 font-mono">
                            {itemId} · {listingLabel(currentListingType)} · {currentFreeShipping ? 'envío incluido' : 'sin envío gratis'}
                        </p>
                    </div>

                    {/* Tipo de publicación */}
                    <div>
                        <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Tipo de publicación</p>
                        <div className="grid grid-cols-2 gap-2">
                            {LISTING_TYPES.map(t => (
                                <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => setListingType(t.id)}
                                    className={cn(
                                        "p-3 rounded-[var(--radius-sm)] border text-left transition-colors",
                                        listingType === t.id
                                            ? "border-[var(--accent)] bg-[var(--accent)]/10 ring-1 ring-[var(--accent)]/40"
                                            : "border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--text-faint)]",
                                    )}
                                >
                                    <div className="flex items-center gap-1.5">
                                        {t.id === 'gold_pro' ? <Star className="w-3.5 h-3.5 text-[var(--accent)]" /> : <Layers className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
                                        <span className="text-sm font-bold text-[var(--text)]">{t.label}</span>
                                    </div>
                                    <p className="text-[10px] text-[var(--text-muted)] mt-1 leading-snug">{t.desc}</p>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Envío gratis */}
                    <label className="flex items-center justify-between p-3 rounded-[var(--radius-sm)] bg-[var(--surface-2)] border border-[var(--border)] cursor-pointer">
                        <div className="flex items-center gap-2.5">
                            <Truck className="w-4 h-4 text-[var(--accent)]" />
                            <div>
                                <p className="text-sm font-semibold text-[var(--text)]">Envío gratis</p>
                                <p className="text-[10px] text-[var(--text-muted)]">El costo del envío lo absorbes tú</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={freeShipping}
                            onClick={() => setFreeShipping(v => !v)}
                            className={cn(
                                "relative w-11 h-6 rounded-full transition-colors",
                                freeShipping ? "bg-[var(--ok)]" : "bg-[var(--border)]",
                            )}
                        >
                            <span
                                className={cn(
                                    "absolute top-0.5 w-5 h-5 rounded-full bg-[var(--text)] shadow transition-transform",
                                    freeShipping ? "translate-x-[22px]" : "translate-x-0.5",
                                )}
                            />
                        </button>
                    </label>

                    {/* Precio */}
                    <div>
                        <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Precio (opcional)</p>
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={price}
                            onChange={e => setPrice(e.target.value)}
                            placeholder={`Mismo precio: $${Number(currentPrice || 0).toLocaleString('es-MX')}`}
                            className="w-full px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--surface-2)] border border-[var(--border)] text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]"
                        />
                        <p className="text-[10px] text-[var(--text-faint)] mt-1">Déjalo vacío para conservar el precio del ítem original.</p>
                    </div>

                    {/* Resultado / error */}
                    {result && !result.dry_run && (
                        <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--ok)]/10 border border-[var(--ok)]/30">
                            <div className="flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-[var(--ok)]" />
                                <p className="text-sm font-bold text-[var(--ok)]">Condición creada: {result.item_id}</p>
                            </div>
                            <a
                                href={result.permalink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline mt-1.5"
                            >
                                Ver en Mercado Libre <ExternalLink className="w-3 h-3" />
                            </a>
                        </div>
                    )}
                    {result?.dry_run && (
                        <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--warn)]/10 border border-[var(--warn)]/30 text-xs text-[var(--text-muted)]">
                            <p className="font-semibold text-[var(--warn)] mb-1">Vista previa correcta — no se publicó nada.</p>
                            Revisa el body en la consola del servidor y confirma con &quot;Crear condición&quot;.
                        </div>
                    )}
                    {error && (
                        <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--err)]/10 border border-[var(--err)]/30">
                            <div className="flex items-start gap-2">
                                <AlertCircle className="w-4 h-4 text-[var(--err)] mt-0.5 shrink-0" />
                                <p className="text-xs text-[var(--err)] break-words">{error}</p>
                            </div>
                        </div>
                    )}

                    {/* Acciones */}
                    <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                            type="button"
                            onClick={() => submit(true)}
                            disabled={loading}
                            className="px-3 py-2 text-xs font-bold text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--surface-2)] disabled:opacity-50 transition-colors"
                        >
                            Vista previa
                        </button>
                        <button
                            type="button"
                            onClick={() => submit(false)}
                            disabled={loading}
                            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-[var(--accent-ink)] bg-[var(--accent)] rounded-[var(--radius-sm)] hover:opacity-90 disabled:opacity-50 transition-colors"
                        >
                            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />}
                            Crear condición
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
