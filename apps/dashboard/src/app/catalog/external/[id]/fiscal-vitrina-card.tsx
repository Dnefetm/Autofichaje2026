"use client";

import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
    FileText, Pencil, Check, X, Loader2, Copy, ArrowRight, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    MeliFiscalAttributes,
    SAT_MEASURE_PRESETS,
    IVA_OPTIONS,
    IEPS_RATES,
    isValidSatKey,
} from '@/lib/meli-fiscal';

interface FiscalVitrinaCardProps {
    pubId: string;
    fiscal: MeliFiscalAttributes | null;
    loading: boolean;
    loadError?: string | null;
    articulo?: {
        articulo_id: string;
        nombre?: string | null;
        codigo_sat?: string | null;
    } | null;
    onSaved: () => Promise<void> | void;
}

export function FiscalVitrinaCard({
    pubId,
    fiscal,
    loading,
    loadError,
    articulo,
    onSaved,
}: FiscalVitrinaCardProps) {
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [syncingDir, setSyncingDir] = useState<'cat_to_meli' | 'meli_to_cat' | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [satKey, setSatKey] = useState('');
    const [iva, setIva] = useState('');
    const [ieps, setIeps] = useState('');
    const [unitKey, setUnitKey] = useState('');
    const [unitDesc, setUnitDesc] = useState('');
    const [invoiceName, setInvoiceName] = useState('');
    const [pedimento, setPedimento] = useState('');
    const [syncToCatalog, setSyncToCatalog] = useState(true);

    function loadDraftFromProps() {
        setSatKey(fiscal?.sat_key ?? '');
        setIva(fiscal?.iva_for_resale ?? '');
        setIeps(fiscal?.ieps ?? '');
        setUnitKey(fiscal?.measure_unit_key ?? '');
        setUnitDesc(fiscal?.measure_unit_description ?? '');
        setInvoiceName(fiscal?.invoice_product_name ?? '');
        setPedimento(fiscal?.import_declaration_number ?? '');
        setSyncToCatalog(Boolean(articulo?.articulo_id));
        setError(null);
    }

    useEffect(() => {
        if (!editing) {
            loadDraftFromProps();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fiscal, articulo?.articulo_id, editing]);

    const meliSat = (fiscal?.sat_key ?? '').trim();
    const artSat = (articulo?.codigo_sat ?? '').trim();
    const meliSatValid = isValidSatKey(meliSat);
    const artSatValid = isValidSatKey(artSat);

    const statusBadge = (() => {
        if (loading && !fiscal) {
            return {
                label: 'Consultando MeLi…',
                tone: 'bg-[var(--surface-2)] text-[var(--text-faint)] border border-[var(--border)]',
            };
        }
        if (meliSat && artSat && meliSat === artSat) {
            return {
                label: '✓ Alineado con Catálogo',
                tone: 'bg-[var(--ok)]/10 text-[var(--ok)] border border-[var(--ok)]/30',
            };
        }
        if (meliSat && artSat && meliSat !== artSat) {
            return {
                label: `⚠ Difiere del Catálogo (BD: ${artSat})`,
                tone: 'bg-[var(--warn)]/10 text-[var(--warn)] border border-[var(--warn)]/30',
            };
        }
        if (!meliSat && artSat) {
            return artSatValid
                ? {
                    label: `Falta en MeLi (Catálogo: ${artSat})`,
                    tone: 'bg-[var(--info)]/10 text-[var(--info)] border border-[var(--info)]/30',
                }
                : {
                    label: `Falta en MeLi (SAT BD inválido: ${artSat})`,
                    tone: 'bg-[var(--warn)]/10 text-[var(--warn)] border border-[var(--warn)]/30',
                };
        }
        if (meliSat && !artSat && articulo?.articulo_id) {
            return {
                label: 'Falta en Catálogo',
                tone: 'bg-[var(--info)]/10 text-[var(--info)] border border-[var(--info)]/30',
            };
        }
        if (meliSat && !articulo?.articulo_id) {
            return {
                label: 'En MeLi (sin artículo mapeado)',
                tone: 'bg-[var(--ok)]/10 text-[var(--ok)] border border-[var(--ok)]/30',
            };
        }
        return {
            label: 'Sin clave SAT en MeLi ni Catálogo',
            tone: 'bg-[var(--surface-2)] text-[var(--text-faint)] border border-[var(--border)]',
        };
    })();

    const canCopyCatToMeli = Boolean(artSatValid && meliSat !== artSat);
    const canCopyMeliToCat = Boolean(articulo?.articulo_id && meliSatValid && meliSat !== artSat);

    async function copySatToClipboard(val: string) {
        try {
            await navigator.clipboard.writeText(val);
            toast.success(`Clave SAT ${val} copiada`);
        } catch {
            toast.error('No se pudo copiar al portapapeles');
        }
    }

    async function handleQuickCatalogToMeli() {
        if (!artSatValid || syncingDir) return;
        setSyncingDir('cat_to_meli');
        setError(null);
        try {
            const res = await fetch(`/api/vitrinas/${pubId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    changes: [{ field: 'sat_key', value: artSat }],
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al sincronizar con MeLi');
            const r = Array.isArray(data.applied) ? data.applied.find((a: any) => a.field === 'sat_key') : null;
            if (r && !r.ok) throw new Error(r.error || 'MeLi rechazó la clave SAT');
            toast.success(`Clave SAT ${artSat} enviada a MeLi`);
            await onSaved();
        } catch (e: any) {
            const msg = e?.message || 'Error al enviar clave SAT a MeLi';
            setError(msg);
            toast.error(msg);
        } finally {
            setSyncingDir(null);
        }
    }

    async function handleQuickMeliToCatalog() {
        if (!articulo?.articulo_id || !meliSatValid || syncingDir) return;
        setSyncingDir('meli_to_cat');
        setError(null);
        try {
            const res = await fetch(`/api/vitrinas/${pubId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'sync_sat_to_articulo',
                    articulo_id: articulo.articulo_id,
                    codigo_sat: meliSat,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'Error al guardar en Catálogo');
            toast.success(`Clave SAT ${meliSat} guardada en Catálogo`);
            await onSaved();
        } catch (e: any) {
            const msg = e?.message || 'Error al guardar en Catálogo';
            setError(msg);
            toast.error(msg);
        } finally {
            setSyncingDir(null);
        }
    }

    async function handleSaveForm() {
        if (saving) return;
        setError(null);

        const changes: Array<{ field: string; value: string }> = [];
        const trim = (v: string) => v.trim();

        const nextSat = trim(satKey);
        if (nextSat && nextSat !== (fiscal?.sat_key ?? '').trim()) {
            if (!isValidSatKey(nextSat)) {
                setError('La clave SAT debe tener exactamente 8 dígitos numéricos');
                return;
            }
            changes.push({ field: 'sat_key', value: nextSat });
        }

        const nextIva = trim(iva);
        if (nextIva && nextIva !== (fiscal?.iva_for_resale ?? '').trim()) {
            changes.push({ field: 'iva_for_resale', value: nextIva });
        }

        const nextIeps = trim(ieps);
        if (nextIeps && nextIeps !== (fiscal?.ieps ?? '').trim()) {
            changes.push({ field: 'ieps', value: nextIeps });
        }

        const nextUnitKey = trim(unitKey).toUpperCase();
        if (nextUnitKey && nextUnitKey !== (fiscal?.measure_unit_key ?? '').trim().toUpperCase()) {
            changes.push({ field: 'measure_unit_key', value: nextUnitKey });
        }

        const nextUnitDesc = trim(unitDesc);
        if (nextUnitDesc && nextUnitDesc !== (fiscal?.measure_unit_description ?? '').trim()) {
            changes.push({ field: 'measure_unit_description', value: nextUnitDesc });
        }

        const nextInvoiceName = trim(invoiceName);
        if (nextInvoiceName && nextInvoiceName !== (fiscal?.invoice_product_name ?? '').trim()) {
            changes.push({ field: 'invoice_product_name', value: nextInvoiceName });
        }

        const prevPedimento = (fiscal?.import_declaration_number ?? '').replace(/\D/g, '').slice(0, 18);
        const nextPedimento = pedimento.replace(/\D/g, '').slice(0, 18);
        if (nextPedimento !== prevPedimento) {
            changes.push({ field: 'import_declaration_number', value: nextPedimento });
        }

        const shouldOnlySyncSatToCatalog =
            changes.length === 0 &&
            syncToCatalog &&
            Boolean(articulo?.articulo_id) &&
            isValidSatKey(nextSat) &&
            nextSat === meliSat &&
            nextSat !== artSat;

        if (changes.length === 0 && !shouldOnlySyncSatToCatalog) {
            setEditing(false);
            return;
        }

        setSaving(true);
        try {
            if (shouldOnlySyncSatToCatalog && articulo?.articulo_id) {
                const res = await fetch(`/api/vitrinas/${pubId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'sync_sat_to_articulo',
                        articulo_id: articulo.articulo_id,
                        codigo_sat: nextSat,
                    }),
                });
                const data = await res.json();
                if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar en Catálogo');
                toast.success(`Clave SAT ${nextSat} sincronizada al Catálogo`);
                setEditing(false);
                await onSaved();
                return;
            }

            const res = await fetch(`/api/vitrinas/${pubId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    changes,
                    ...(syncToCatalog && articulo?.articulo_id
                        ? { sync_sat_to_articulo: true, articulo_id: articulo.articulo_id }
                        : {}),
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al sincronizar con MeLi');

            const applied: Array<{ field: string; ok: boolean; error?: string }> = Array.isArray(data.applied)
                ? data.applied
                : [];
            const failed = applied.filter(a => !a.ok);
            const succeeded = applied.filter(a => a.ok);

            if (succeeded.length > 0) {
                await onSaved();
            }

            if (failed.length > 0) {
                const msg = failed.map(f => `${f.field}: ${f.error || 'rechazado'}`).join(' · ');
                setError(msg);
                if (succeeded.length > 0) {
                    toast.warning(`Se guardaron ${succeeded.length} campo(s), pero falló: ${msg}`);
                } else {
                    toast.error(msg);
                }
                return;
            }

            if (data.sat_articulo_error) {
                toast.warning(`Guardado en MeLi, pero falló Catálogo: ${data.sat_articulo_error}`);
            } else if (data.sat_articulo_synced) {
                toast.success('Datos fiscales guardados en MeLi y Catálogo');
            } else {
                toast.success('Datos fiscales actualizados en MeLi');
            }
            setEditing(false);
        } catch (e: any) {
            const msg = e?.message || 'Error al guardar datos fiscales';
            setError(msg);
            toast.error(msg);
        } finally {
            setSaving(false);
        }
    }

    const rows: Array<{ label: string; value: string | null; mono?: boolean; isSat?: boolean }> = [
        { label: 'Clave SAT', value: fiscal?.sat_key ?? null, mono: true, isSat: true },
        { label: 'IVA reventa', value: fiscal?.iva_for_resale ?? null },
        { label: 'IEPS', value: fiscal?.ieps ?? null },
        {
            label: 'Unidad SAT',
            value: fiscal?.measure_unit_key
                ? (fiscal?.measure_unit_description
                    ? `${fiscal.measure_unit_key} — ${fiscal.measure_unit_description}`
                    : fiscal.measure_unit_key)
                : (fiscal?.measure_unit_description ?? null),
        },
        { label: 'Nombre factura', value: fiscal?.invoice_product_name ?? null },
        { label: 'Pedimento', value: fiscal?.import_declaration_number ?? null, mono: true },
    ];

    const satDraftTrim = satKey.trim();
    const satDraftInvalid = satDraftTrim.length > 0 && !isValidSatKey(satDraftTrim);

    return (
        <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] overflow-hidden">
            <div className="px-5 py-2.5 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-2 bg-[var(--surface-2)]">
                <div className="flex items-center gap-2.5">
                    <div className="text-[var(--text-faint)]"><FileText className="w-4 h-4" /></div>
                    <h2 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">Datos Fiscales (SAT / CFDI)</h2>
                </div>
                <div className="flex items-center gap-2">
                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-[var(--radius-sm)]', statusBadge.tone)}>
                        {statusBadge.label}
                    </span>
                    {!editing && (
                        <button
                            type="button"
                            onClick={() => { loadDraftFromProps(); setEditing(true); }}
                            disabled={loading && !fiscal}
                            className="p-1 rounded hover:bg-[var(--surface)] text-[var(--text-faint)] hover:text-[var(--accent)] disabled:opacity-40"
                            title="Editar datos fiscales"
                        >
                            <Pencil className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>

            <div className="px-5 py-2">
                {loadError && (
                    <div className="my-2 p-2.5 rounded-[var(--radius-sm)] bg-[var(--warn)]/10 border border-[var(--warn)]/30 text-[11px] text-[var(--warn)] flex items-start gap-2">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>No se pudo consultar MeLi en vivo: {loadError}</span>
                    </div>
                )}

                {loading && !fiscal ? (
                    <div className="py-4 flex items-center gap-2 text-xs text-[var(--text-faint)]">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Cargando atributos fiscales desde MeLi…
                    </div>
                ) : editing ? (
                    <div className="py-2 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <label className="block">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                    Clave SAT ProdServ (8 dígitos)
                                </span>
                                <input
                                    type="text"
                                    value={satKey}
                                    onChange={(e) => setSatKey(e.target.value)}
                                    placeholder="ej. 27111701"
                                    maxLength={20}
                                    className="mt-0.5 w-full h-9 px-2.5 text-sm border border-[var(--border)] rounded-[var(--radius)] bg-[var(--surface-2)] font-mono focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                                />
                                {satDraftInvalid && (
                                    <span className="text-[10px] text-[var(--err)] block mt-0.5">
                                        Debe tener exactamente 8 dígitos numéricos.
                                    </span>
                                )}
                            </label>

                            <div className="grid grid-cols-2 gap-2">
                                <label className="block">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">IVA</span>
                                    <select
                                        value={iva}
                                        onChange={(e) => setIva(e.target.value)}
                                        className="mt-0.5 w-full h-9 px-2 text-sm border border-[var(--border)] rounded-[var(--radius)] bg-[var(--surface-2)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                                    >
                                        <option value="">— Sin cambio —</option>
                                        {IVA_OPTIONS.map((opt) => (
                                            <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="block">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">IEPS</span>
                                    <select
                                        value={ieps}
                                        onChange={(e) => setIeps(e.target.value)}
                                        className="mt-0.5 w-full h-9 px-2 text-sm border border-[var(--border)] rounded-[var(--radius)] bg-[var(--surface-2)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                                    >
                                        <option value="">— Sin cambio —</option>
                                        {IEPS_RATES.map((rate) => (
                                            <option key={rate} value={rate}>{rate}</option>
                                        ))}
                                    </select>
                                </label>
                            </div>

                            <label className="block">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                    Unidad de medida SAT
                                </span>
                                <select
                                    value={SAT_MEASURE_PRESETS.some(p => p.key === unitKey.trim().toUpperCase() && p.desc === unitDesc.trim()) ? `${unitKey.trim().toUpperCase()}|${unitDesc.trim()}` : 'CUSTOM'}
                                    onChange={(e) => {
                                        if (e.target.value === 'CUSTOM') return;
                                        const [k, d] = e.target.value.split('|');
                                        setUnitKey(k);
                                        setUnitDesc(d);
                                    }}
                                    className="mt-0.5 w-full h-9 px-2 text-sm border border-[var(--border)] rounded-[var(--radius)] bg-[var(--surface-2)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                                >
                                    <option value="CUSTOM">Personalizada…</option>
                                    {SAT_MEASURE_PRESETS.map((p) => (
                                        <option key={p.key} value={`${p.key}|${p.desc}`}>{p.key} — {p.desc}</option>
                                    ))}
                                </select>
                            </label>

                            <div className="grid grid-cols-2 gap-2">
                                <label className="block">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Clave unidad</span>
                                    <input
                                        type="text"
                                        value={unitKey}
                                        onChange={(e) => setUnitKey(e.target.value)}
                                        placeholder="H87"
                                        className="mt-0.5 w-full h-9 px-2.5 text-sm border border-[var(--border)] rounded-[var(--radius)] bg-[var(--surface-2)] font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Descripción unidad</span>
                                    <input
                                        type="text"
                                        value={unitDesc}
                                        onChange={(e) => setUnitDesc(e.target.value)}
                                        placeholder="Pieza"
                                        className="mt-0.5 w-full h-9 px-2.5 text-sm border border-[var(--border)] rounded-[var(--radius)] bg-[var(--surface-2)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                                    />
                                </label>
                            </div>

                            <label className="block sm:col-span-2">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                    Nombre fiscal en factura (CFDI)
                                </span>
                                <input
                                    type="text"
                                    value={invoiceName}
                                    onChange={(e) => setInvoiceName(e.target.value)}
                                    maxLength={255}
                                    placeholder="Descripción fiscal para factura"
                                    className="mt-0.5 w-full h-9 px-2.5 text-sm border border-[var(--border)] rounded-[var(--radius)] bg-[var(--surface-2)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                                />
                            </label>

                            <label className="block sm:col-span-2">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                        Número de pedimento de importación (opcional)
                                    </span>
                                    {pedimento.trim().length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setPedimento('')}
                                            className="text-[10px] font-bold text-[var(--err)] hover:underline"
                                        >
                                            Limpiar
                                        </button>
                                    )}
                                </div>
                                <input
                                    type="text"
                                    value={pedimento}
                                    onChange={(e) => setPedimento(e.target.value)}
                                    maxLength={20}
                                    placeholder="Solo si eres importador de primera mano (vacío = limpiar)"
                                    className="mt-0.5 w-full h-9 px-2.5 text-sm border border-[var(--border)] rounded-[var(--radius)] bg-[var(--surface-2)] font-mono focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                                />
                            </label>
                        </div>

                        {articulo?.articulo_id && (
                            <label className="inline-flex items-center gap-2 text-xs text-[var(--text-muted)] cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={syncToCatalog}
                                    onChange={(e) => setSyncToCatalog(e.target.checked)}
                                    className="w-4 h-4 rounded text-[var(--accent)] focus:ring-[var(--accent)]"
                                />
                                <span>
                                    Sincronizar también <code className="font-mono">codigo_sat</code> al artículo del Catálogo (
                                    <span className="font-mono">{articulo.articulo_id}</span>)
                                </span>
                            </label>
                        )}

                        {error && (
                            <p className="text-xs text-[var(--err)] bg-[var(--err)]/10 border border-[var(--err)]/30 rounded-[var(--radius-sm)] px-2.5 py-1.5 break-words">
                                {error}
                            </p>
                        )}

                        <div className="flex items-center gap-2 pt-1">
                            <button
                                type="button"
                                onClick={handleSaveForm}
                                disabled={saving || satDraftInvalid}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-[var(--accent)] text-[var(--accent-ink)] rounded-[var(--radius-sm)] hover:brightness-110 disabled:opacity-50"
                            >
                                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                {syncToCatalog && articulo?.articulo_id ? 'Guardar en MeLi + Catálogo' : 'Guardar en MeLi'}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setEditing(false); setError(null); }}
                                disabled={saving}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--surface-2)]"
                            >
                                <X className="w-3.5 h-3.5" /> Cancelar
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        {rows.map((row) => (
                            <div key={row.label} className="flex items-start justify-between py-1.5 border-b border-[var(--border)] last:border-0 gap-2">
                                <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider shrink-0 w-36">
                                    {row.label}
                                </span>
                                <div className="text-sm text-[var(--text)] text-right flex-1 break-words flex items-center justify-end gap-1.5 min-w-0">
                                    {row.value ? (
                                        <>
                                            <span className={row.mono ? 'font-mono text-xs font-semibold' : ''}>{row.value}</span>
                                            {row.isSat && (
                                                <button
                                                    type="button"
                                                    onClick={() => copySatToClipboard(row.value!)}
                                                    className="p-0.5 rounded hover:bg-[var(--surface-2)] text-[var(--text-faint)] hover:text-[var(--accent)]"
                                                    title="Copiar clave SAT"
                                                >
                                                    <Copy className="w-3 h-3" />
                                                </button>
                                            )}
                                        </>
                                    ) : (
                                        <span className="text-[var(--text-faint)]">—</span>
                                    )}
                                </div>
                            </div>
                        ))}

                        {articulo?.articulo_id && (
                            <div className="flex items-center justify-between py-1.5 border-t border-[var(--border)] gap-2">
                                <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider shrink-0 w-36">
                                    SAT en Catálogo
                                </span>
                                <div className="text-right flex-1 flex items-center justify-end gap-1.5 min-w-0">
                                    {artSat ? (
                                        <span className={cn(
                                            'font-mono text-xs font-semibold inline-flex items-center gap-1',
                                            meliSat === artSat ? 'text-[var(--ok)]' : (artSatValid ? 'text-[var(--text)]' : 'text-[var(--err)]'),
                                        )}>
                                            {meliSat === artSat && <CheckCircle2 className="w-3 h-3" />}
                                            {artSat}
                                        </span>
                                    ) : (
                                        <span className="text-[var(--text-faint)] text-xs">Sin clave en artículo</span>
                                    )}
                                </div>
                            </div>
                        )}

                        {error && (
                            <p className="my-2 text-xs text-[var(--err)] bg-[var(--err)]/10 border border-[var(--err)]/30 rounded-[var(--radius-sm)] px-2.5 py-1.5 break-words">
                                {error}
                            </p>
                        )}

                        {(canCopyCatToMeli || canCopyMeliToCat) && (
                            <div className="py-2.5 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)]">
                                {canCopyCatToMeli && (
                                    <button
                                        type="button"
                                        onClick={handleQuickCatalogToMeli}
                                        disabled={syncingDir !== null}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold bg-[var(--accent)] text-[var(--accent-ink)] rounded-[var(--radius-sm)] hover:brightness-110 disabled:opacity-50"
                                    >
                                        {syncingDir === 'cat_to_meli' ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
                                        Copiar Catálogo → MeLi ({artSat})
                                    </button>
                                )}
                                {canCopyMeliToCat && (
                                    <button
                                        type="button"
                                        onClick={handleQuickMeliToCatalog}
                                        disabled={syncingDir !== null}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--bg)] disabled:opacity-50"
                                    >
                                        {syncingDir === 'meli_to_cat' ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
                                        Guardar MeLi → Catálogo ({meliSat})
                                    </button>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
