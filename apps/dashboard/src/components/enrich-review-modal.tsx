"use client";
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { X, Check, RefreshCw, Globe, ImageIcon, FileText, Link2, ExternalLink } from 'lucide-react';

interface EnriquecimientoWeb {
    imagen?: string | null;
    imagenes?: string[];
    descripcionLarga?: string | null;
    categoriaOficial?: string | null;
    atributos?: Record<string, string>;
    urlFicha?: string | null;
}

function badge(estado: string) {
    if (estado === 'vacio') {
        return <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[var(--ok)]/15 text-[var(--ok)]">Vacío → completar</span>;
    }
    if (estado === 'conflicto') {
        return <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[var(--warn)]/15 text-[var(--warn)]">Conflicto / reemplazo</span>;
    }
    if (estado === 'igual') {
        return <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text-faint)]">Sin cambios</span>;
    }
    return <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text-faint)]">Sin datos</span>;
}

export default function EnrichReviewModal({
    articuloId,
    descripcionActual = '',
    imagenesActuales = [],
    onClose,
    onSuccess,
}: {
    articuloId: string;
    descripcionActual?: string | null;
    imagenesActuales?: string[];
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [e, setE] = useState<EnriquecimientoWeb | null>(null);
    const [checkImagen, setCheckImagen] = useState(false);
    const [checkDescripcion, setCheckDescripcion] = useState(false);
    const [checkUrl, setCheckUrl] = useState(false);
    const [descEditable, setDescEditable] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        cargar();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [articuloId]);

    async function cargar() {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/enriquecer-web', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ articulo_id: articuloId }),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'Error al extraer de la web');
            setE(data.enriquecimiento || null);
            setDescEditable(data.enriquecimiento?.descripcionLarga || '');
        } catch (err: any) {
            setError(err.message || 'Error de red');
        } finally {
            setLoading(false);
        }
    }

    const imagenPropuesta = e?.imagen || null;
    const imagenActual = imagenesActuales[0] || null;
    const estadoImagen = !imagenPropuesta
        ? 'sin_datos'
        : !imagenActual
        ? 'vacio'
        : imagenActual === imagenPropuesta
        ? 'igual'
        : 'conflicto';

    const descActual = (descripcionActual || '').trim();
    const descPropuesta = (descEditable || '').trim();
    const estadoDescripcion = !descPropuesta
        ? 'sin_datos'
        : !descActual
        ? 'vacio'
        : descActual === descPropuesta
        ? 'igual'
        : 'conflicto';

    const seleccionados = (checkImagen ? 1 : 0) + (checkDescripcion ? 1 : 0) + (checkUrl ? 1 : 0);

    async function aplicar() {
        const campos: Record<string, any> = {};
        if (checkImagen && imagenPropuesta) {
            campos.url_imagen = imagenPropuesta;
            campos.imagenes = Array.from(new Set([imagenPropuesta, ...imagenesActuales.filter((u) => u !== imagenPropuesta)]));
        }
        if (checkDescripcion && descPropuesta) {
            campos.descripcion = descPropuesta;
        }
        if (checkUrl && e?.urlFicha) {
            campos.url_producto = e.urlFicha;
        }
        if (Object.keys(campos).length === 0) return;
        setSaving(true);
        try {
            const res = await fetch(`/api/articulos/${encodeURIComponent(articuloId)}/enriquecer-aplicar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ campos }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al aplicar');
            toast.success(`Aplicado: ${Object.keys(campos).length} campo(s).`);
            onSuccess();
            onClose();
        } catch (err: any) {
            toast.error(err.message || 'Error al aplicar');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85dvh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--surface-2)] shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <Globe className="w-4 h-4 text-[var(--accent)] shrink-0" />
                        <h2 className="text-sm font-bold text-[var(--text)]">Extraer de la web del proveedor</h2>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-[var(--surface)] text-[var(--text-muted)] rounded-lg transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {loading ? (
                        <div className="py-16 text-center text-[var(--text-faint)] flex flex-col items-center gap-3">
                            <RefreshCw className="w-6 h-6 animate-spin" />
                            <p className="text-sm">Consultando la web del proveedor…</p>
                        </div>
                    ) : error ? (
                        <div className="py-16 text-center text-[var(--text-faint)] flex flex-col items-center gap-3">
                            <Globe className="w-8 h-8 opacity-40" />
                            <p className="text-sm max-w-sm">{error}</p>
                        </div>
                    ) : !e ? (
                        <div className="py-16 text-center text-[var(--text-faint)] flex flex-col items-center gap-3">
                            <Globe className="w-8 h-8 opacity-40" />
                            <p className="text-sm">No hay datos de la web para este artículo.</p>
                        </div>
                    ) : (
                        <>
                            {e.urlFicha && (
                                <a
                                    href={e.urlFicha}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--info)] hover:underline"
                                >
                                    <ExternalLink className="w-3.5 h-3.5" /> Abrir ficha oficial del proveedor
                                </a>
                            )}

                            {/* Imagen */}
                            <div className={`p-3 rounded-xl border transition-colors ${checkImagen ? 'border-[var(--ok)]/50 bg-[var(--ok)]/5' : 'border-[var(--border)] bg-[var(--surface-2)]/40'}`}>
                                <div className="flex items-center justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-2">
                                        <label className="flex items-center gap-2 cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                checked={checkImagen}
                                                onChange={(ev) => setCheckImagen(ev.target.checked)}
                                                disabled={!imagenPropuesta}
                                                className="w-4 h-4 accent-[var(--accent)]"
                                            />
                                            <ImageIcon className="w-4 h-4 text-[var(--text-muted)]" />
                                            <span className="text-sm font-semibold text-[var(--text)]">Imagen</span>
                                        </label>
                                    </div>
                                    {badge(estadoImagen)}
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-16 h-16 border border-[var(--border)] rounded-lg bg-[var(--surface)] flex items-center justify-center overflow-hidden">
                                        {imagenPropuesta ? <img src={imagenPropuesta} alt="Propuesta" className="w-full h-full object-contain" /> : <span className="text-[10px] text-[var(--text-faint)]">—</span>}
                                    </div>
                                    <div className="text-xs text-[var(--text-faint)]">Propuesta</div>
                                    <div className="w-16 h-16 border border-[var(--border)] rounded-lg bg-[var(--surface)] flex items-center justify-center overflow-hidden">
                                        {imagenActual ? <img src={imagenActual} alt="Actual" className="w-full h-full object-contain" /> : <span className="text-[10px] text-[var(--text-faint)]">Sin imagen</span>}
                                    </div>
                                    <div className="text-xs text-[var(--text-faint)]">Actual</div>
                                </div>
                            </div>

                            {/* Descripción */}
                            <div className={`p-3 rounded-xl border transition-colors ${checkDescripcion ? 'border-[var(--ok)]/50 bg-[var(--ok)]/5' : 'border-[var(--border)] bg-[var(--surface-2)]/40'}`}>
                                <div className="flex items-center justify-between gap-2 mb-2">
                                    <label className="flex items-center gap-2 cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={checkDescripcion}
                                            onChange={(ev) => setCheckDescripcion(ev.target.checked)}
                                            disabled={!descPropuesta}
                                            className="w-4 h-4 accent-[var(--accent)]"
                                        />
                                        <FileText className="w-4 h-4 text-[var(--text-muted)]" />
                                        <span className="text-sm font-semibold text-[var(--text)]">Descripción</span>
                                    </label>
                                    {badge(estadoDescripcion)}
                                </div>
                                {descActual && (
                                    <div className="mb-2 text-xs">
                                        <span className="text-[var(--text-faint)]">Actual: </span>
                                        <span className="text-[var(--text-muted)] line-clamp-3">{descActual}</span>
                                    </div>
                                )}
                                <textarea
                                    value={descEditable}
                                    onChange={(ev) => setDescEditable(ev.target.value)}
                                    rows={10}
                                    className="w-full px-3 py-2 text-xs border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:ring-2 focus:ring-[var(--accent)] focus:outline-none"
                                    placeholder="Descripción propuesta (editable)"
                                />
                            </div>

                            {/* Enlace oficial */}
                            {e.urlFicha && (
                                <div className={`p-3 rounded-xl border transition-colors ${checkUrl ? 'border-[var(--ok)]/50 bg-[var(--ok)]/5' : 'border-[var(--border)] bg-[var(--surface-2)]/40'}`}>
                                    <label className="flex items-center gap-2 cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={checkUrl}
                                            onChange={(ev) => setCheckUrl(ev.target.checked)}
                                            className="w-4 h-4 accent-[var(--accent)]"
                                        />
                                        <Link2 className="w-4 h-4 text-[var(--text-muted)]" />
                                        <span className="text-sm font-semibold text-[var(--text)]">Enlace oficial</span>
                                        <span className="text-xs text-[var(--text-faint)] truncate">{e.urlFicha}</span>
                                    </label>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                {!loading && !error && e && (
                    <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-[var(--border)] bg-[var(--surface)] shrink-0">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] bg-[var(--surface-2)] border border-[var(--border)] rounded-lg hover:bg-[var(--surface-2)]/80 hover:text-[var(--text)] transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={aplicar}
                            disabled={saving || seleccionados === 0}
                            className="px-5 py-2 text-sm font-semibold rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] hover:brightness-110 disabled:opacity-40 flex items-center gap-2 transition-all"
                        >
                            {saving ? <RefreshCw size={16} className="animate-spin" /> : <Check size={16} />}
                            Aplicar ({seleccionados})
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
