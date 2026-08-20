"use client";

/**
 * PublishPanel — Panel de publicación en MeLi (3 etapas)
 *
 * Etapa 1 — Configuración: cuenta, categoría, tipo de listado, imágenes
 * Etapa 2 — Preview (dry_run: true): trace del endpoint sin publicar
 * Etapa 3 — Resultado: éxito (MLM ID + permalink) o error (409/422/500)
 *
 * NO expone force_duplicate. Si hay 409, muestra el item existente.
 */

import { useState, useEffect, useRef } from 'react';
import {
    Send, Eye, ChevronDown, ChevronUp, Plus, Trash2,
    ArrowUp, ArrowDown, Loader2, CheckCircle2, AlertCircle,
    ExternalLink, ImageIcon, Store, Tag, RefreshCw, XCircle, Search, Package
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

// -- Tipos --------------------------------------------------------------------
interface Account { id: string; account_name: string; }

type Stage = 'config' | 'preview' | 'result';

interface PublishPanelProps {
    articulo_id: string;
    nombreArticulo: string;
    /** UUID de fichas_tecnicas — si viene, el backend usa la ficha como fuente principal */
    ficha_id?: string;
    /** URLs de imágenes base para pre-cargar como sugerencias */
    imagenesBase?: string[];
    /** Modo modal: si true, el panel arranca abierto sin el toggle header */
    modalMode?: boolean;
}

// -- Helpers ------------------------------------------------------------------
function TraceBlock({ trace }: { trace: Record<string, any> }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="mt-3 border border-slate-200 rounded-lg overflow-hidden">
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-slate-500 bg-slate-50 hover:bg-slate-100 transition-colors"
            >
                <span>Ver trace técnico</span>
                {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {open && (
                <pre className="text-[10px] leading-relaxed text-slate-600 bg-slate-50 p-3 overflow-auto max-h-80 whitespace-pre-wrap break-all">
                    {JSON.stringify(trace, null, 2)}
                </pre>
            )}
        </div>
    );
}

// -- Componente principal ------------------------------------------------------
export function PublishPanel({ articulo_id, nombreArticulo, ficha_id, imagenesBase = [], modalMode = false }: PublishPanelProps) {
    // Cuentas
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [selectedAccount, setSelectedAccount] = useState<string>('');

    // Config
    const [categoryId, setCategoryId] = useState('');
    const [listingType, setListingType] = useState('gold_special');

    // Imágenes
    const [images, setImages] = useState<string[]>([]);
    const [newImageUrl, setNewImageUrl] = useState('');
    const [imgInputError, setImgInputError] = useState<string | null>(null);
    const [preloadedSuggestions, setPreloadedSuggestions] = useState<string[]>([]);

    // Estado
    const [stage, setStage] = useState<Stage>('config');
    const [loading, setLoading] = useState(false);
    const [previewResult, setPreviewResult] = useState<any>(null);
    const [publishResult, setPublishResult] = useState<any>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    // Overrides del preview editable
    const [attrOverrides, setAttrOverrides] = useState<Record<string, { value_name?: string; value_id?: string }>>({});
    const [categoryOverride, setCategoryOverride] = useState<string>('');
    const [familyNameOverride, setFamilyNameOverride] = useState<string>('');
    // Atributos dinámicos al cambiar de categoría
    const [dynamicReqAttrs, setDynamicReqAttrs] = useState<any[] | null>(null);
    const [loadingAttrs, setLoadingAttrs] = useState(false);
    const [currentAttrValues, setCurrentAttrValues] = useState<Map<string, { value_id?: string; value_name?: string }>>(new Map());

    // Buscador live de categorías MeLi
    const [catSearch, setCatSearch] = useState('');
    const [catSearchResults, setCatSearchResults] = useState<any[]>([]);
    const [catSearchLoading, setCatSearchLoading] = useState(false);
    const [catSelectedPath, setCatSelectedPath] = useState('');   // ruta de la cat elegida manualmente
    const catSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Dimensiones del paquete editables
    const [dimOverrides, setDimOverrides] = useState<Record<string, string>>({});

    // Panel abierto/cerrado
    const [panelOpen, setPanelOpen] = useState(false);

    // -- Cargar cuentas ------------------------------------------------------
    useEffect(() => {
        supabase
            .from('marketplace_configs')
            .select('id, account_name')
            .eq('is_active', true)
            .then(({ data }) => {
                setAccounts(data || []);
                if (data && data.length === 1) setSelectedAccount(data[0].id);
            });
    }, []);

    // Pre-cargar sugerencias de imágenes del artículo
    useEffect(() => {
        const validUrls = imagenesBase.filter(u => u?.startsWith('http'));
        setPreloadedSuggestions(validUrls);
    }, [imagenesBase]);

    // Si viene ficha_id, cargar también las imágenes propias de la ficha (ficha_imagenes)
    useEffect(() => {
        if (!ficha_id) return;
        fetch(`/api/fichas/${ficha_id}/imagenes`)
            .then(r => r.json())
            .then(data => {
                if (!data.ok) return;
                const fichaUrls: string[] = (data.imagenes ?? []).map((img: any) => img.url).filter(Boolean);
                if (fichaUrls.length > 0) {
                    setPreloadedSuggestions(prev => {
                        // Merge: fichaUrls primero (tienen prioridad), sin duplicar
                        const merged = [...fichaUrls, ...prev.filter(u => !fichaUrls.includes(u))];
                        return merged;
                    });
                }
            })
            .catch(() => { /* silencioso */ });
    }, [ficha_id]);

    // Re-fetch atributos requeridos cuando el usuario cambia la categoría en el preview
    useEffect(() => {
        if (!categoryOverride || !selectedAccount || stage !== 'preview') {
            setDynamicReqAttrs(null);
            setCurrentAttrValues(new Map());
            return;
        }
        const originalCat = previewResult?.data?.trace?.paso_5_categoria?.category_id;
        if (categoryOverride === originalCat) {
            setDynamicReqAttrs(null);
            setCurrentAttrValues(new Map());
            return;
        }
        // Categoría diferente: limpiar estado anterior y recargar
        setDynamicReqAttrs(null);
        setAttrOverrides({});
        setCurrentAttrValues(new Map());
        setLoadingAttrs(true);
        const originalAttrs: any[] = previewResult?.data?.trace?.paso_8_attributes_final || [];
        fetch(`/api/publish/attributes?category_id=${encodeURIComponent(categoryOverride)}&marketplace_id=${encodeURIComponent(selectedAccount)}`)
            .then(r => r.json())
            .then(data => {
                if (data.ok) {
                    setDynamicReqAttrs(data.required);
                    // Reconciliar valores: portar solo los compatibles con la nueva categoría
                    const reconciled = new Map<string, { value_id?: string; value_name?: string }>();
                    for (const attr of data.required) {
                        const fromOriginal = originalAttrs.find((a: any) => a.id === attr.id);
                        if (!fromOriginal) continue;
                        if (attr.values?.length > 0) {
                            // Lista cerrada: solo portar si el value_id sigue siendo válido
                            const validIds = new Set(attr.values.map((v: any) => String(v.id)));
                            if (fromOriginal.value_id && validIds.has(String(fromOriginal.value_id))) {
                                reconciled.set(attr.id, { value_id: String(fromOriginal.value_id), value_name: fromOriginal.value_name });
                            }
                        } else {
                            // Texto libre: portar siempre (BRAND, MODEL, GTIN son cross-categoría)
                            if (fromOriginal.value_name) {
                                reconciled.set(attr.id, { value_name: fromOriginal.value_name });
                            }
                        }
                    }
                    setCurrentAttrValues(reconciled);
                }
            })
            .catch(() => {})
            .finally(() => setLoadingAttrs(false));
    }, [categoryOverride, selectedAccount, stage]);

    // -- Gestión de imágenes --------------------------------------------------
    function addImage() {
        const url = newImageUrl.trim();
        if (!url) return;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            setImgInputError('La URL debe empezar con http:// o https://');
            return;
        }
        if (images.includes(url)) {
            setImgInputError('Esta URL ya está en la lista');
            return;
        }
        setImages(prev => [...prev, url]);
        setNewImageUrl('');
        setImgInputError(null);
    }

    function removeImage(idx: number) {
        setImages(prev => prev.filter((_, i) => i !== idx));
    }

    function moveImage(idx: number, dir: -1 | 1) {
        setImages(prev => {
            const next = [...prev];
            const target = idx + dir;
            if (target < 0 || target >= next.length) return prev;
            [next[idx], next[target]] = [next[target], next[idx]];
            return next;
        });
    }

    function addSuggestion(url: string) {
        if (!images.includes(url)) setImages(prev => [...prev, url]);
    }

    // -- Preview (dry_run) ----------------------------------------------------
    async function handlePreview() {
        if (!selectedAccount) { setErrorMsg('Selecciona una cuenta MeLi'); return; }
        if (images.length === 0) { setErrorMsg('Agrega al menos 1 imagen'); return; }
        setErrorMsg(null);
        setLoading(true);
        setPreviewResult(null);
        try {
            const res = await fetch('/api/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    articulo_id,
                    marketplace_id: selectedAccount,
                    pictures: images,
                    ...(ficha_id ? { ficha_id } : {}),
                    category_id: categoryId || undefined,
                    listing_type_id: listingType,
                    dry_run: true,
                }),
            });
            const data = await res.json();
            setPreviewResult({ status: res.status, data });
            setStage('preview');
        } catch (e: any) {
            setErrorMsg(e.message);
        } finally {
            setLoading(false);
        }
    }

    // -- Re-preview con categoría forzada ---------------------------------------
    // Relanza el dry_run completo con category_id forzado. Reemplaza el trace entero.
    async function handleRePreview(forcedCategoryId: string) {
        if (!selectedAccount || !forcedCategoryId) return;
        setLoading(true);
        setErrorMsg(null);
        try {
            const res = await fetch('/api/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    articulo_id,
                    marketplace_id: selectedAccount,
                    pictures: images,
                    ...(ficha_id ? { ficha_id } : {}),
                    category_id: forcedCategoryId,
                    listing_type_id: listingType,
                    dry_run: true,
                }),
            });
            const data = await res.json();
            setPreviewResult({ status: res.status, data });
            setCategoryOverride('');
            setAttrOverrides({});
            setCurrentAttrValues(new Map());
        } catch (e: any) {
            setErrorMsg(e.message);
        } finally {
            setLoading(false);
        }
    }

    // -- Publicar real ------------------------------------------------------
    async function handlePublish() {
        setLoading(true);
        setErrorMsg(null);
        try {
            const attrOvList = Object.entries(attrOverrides).map(([id, v]) => ({ id, ...v }));
            // Merge dimensiones: convierten a attribute_overrides con value_name
            const dimOvList = Object.entries(dimOverrides)
                .filter(([, v]) => v.trim() !== '')
                .map(([id, v]) => ({ id, value_name: v.trim() }));
            const allOverrides = [...attrOvList, ...dimOvList];
            const res = await fetch('/api/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    articulo_id,
                    marketplace_id: selectedAccount,
                    pictures: images,
                    ...(ficha_id ? { ficha_id } : {}),
                    category_id: categoryOverride || categoryId || undefined,
                    listing_type_id: listingType,
                    dry_run: false,
                    ...(allOverrides.length > 0 ? { attribute_overrides: allOverrides } : {}),
                    ...(familyNameOverride ? { family_name_override: familyNameOverride } : {}),
                }),
            });
            const data = await res.json();
            setPublishResult({ status: res.status, data });
            setStage('result');
        } catch (e: any) {
            setErrorMsg(e.message);
        } finally {
            setLoading(false);
        }
    }

    function resetPanel() {
        setStage('config');
        setPreviewResult(null);
        setPublishResult(null);
        setErrorMsg(null);
        setAttrOverrides({});
        setCategoryOverride('');
        setFamilyNameOverride('');
        setCurrentAttrValues(new Map());
        setDimOverrides({});
        setCatSearch('');
        setCatSearchResults([]);
        setCatSelectedPath('');
    }

    const accountName = accounts.find(a => a.id === selectedAccount)?.account_name || selectedAccount;

    // -- Render -------------------------------------------------------
    // En modalMode (desde fichas), el panel arranca abierto directamente
    const isOpen = modalMode ? true : panelOpen;

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Header — toggle del panel (se oculta en modalMode) */}
            {!modalMode && (
                <button
                    id="publish-panel-toggle"
                    onClick={() => setPanelOpen(o => !o)}
                    className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-yellow-100 rounded-lg">
                            <Send className="w-4 h-4 text-yellow-600" />
                        </div>
                        <div className="text-left">
                            <h2 className="text-base font-bold text-slate-900">Publicar en MeLi</h2>
                            <p className="text-xs text-slate-400 mt-0.5">
                                Modelo User Products · Aprobación manual requerida
                                {ficha_id && <span className="ml-2 px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-[9px] font-bold">Datos desde ficha técnica</span>}
                            </p>
                        </div>
                    </div>
                    {panelOpen
                        ? <ChevronUp className="w-5 h-5 text-slate-400" />
                        : <ChevronDown className="w-5 h-5 text-slate-400" />
                    }
                </button>
            )}

            {isOpen && (
                <div className={`${!modalMode ? 'border-t border-slate-100' : ''} px-6 py-5 space-y-5`}>
                    {/* Badge de ficha en modal mode */}
                    {modalMode && ficha_id && (
                        <div className="flex items-center gap-2 p-2.5 bg-indigo-50 border border-indigo-200 rounded-xl">
                            <span className="text-xs font-bold text-indigo-700">📄 Publicando con datos de la ficha técnica</span>
                            <span className="text-[10px] text-indigo-400 font-mono">{ficha_id.slice(0, 8)}…</span>
                        </div>
                    )}

                    {/* -- ETAPA 1: CONFIGURACIÓN ------------------------ */}
                    {stage === 'config' && (
                        <>
                            {/* Cuenta */}
                            <div>
                                <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1.5">
                                    <Store className="w-3 h-3 inline mr-1" />Cuenta de destino <span className="text-rose-400">*</span>
                                </label>
                                <select
                                    id="publish-account-select"
                                    value={selectedAccount}
                                    onChange={e => setSelectedAccount(e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400 bg-white"
                                >
                                    <option value="">— Selecciona una cuenta —</option>
                                    {accounts.map(a => (
                                        <option key={a.id} value={a.id}>{a.account_name}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Categoría + Tipo de listado */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1.5">
                                        <Tag className="w-3 h-3 inline mr-1" />Categoría MeLi
                                    </label>
                                    <input
                                        id="publish-category-id"
                                        type="text"
                                        value={categoryId}
                                        onChange={e => setCategoryId(e.target.value)}
                                        placeholder="Auto-detectada por AI"
                                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400 bg-white font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1.5">
                                        Tipo de listado
                                    </label>
                                    <select
                                        id="publish-listing-type"
                                        value={listingType}
                                        onChange={e => setListingType(e.target.value)}
                                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400 bg-white"
                                    >
                                        <option value="gold_special">Gold Special (recomendado)</option>
                                        <option value="gold_pro">Gold Pro</option>
                                        <option value="silver">Silver</option>
                                        <option value="free">Free</option>
                                    </select>
                                </div>
                            </div>

                            {/* Imágenes */}
                            <div>
                                <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1.5">
                                    <ImageIcon className="w-3 h-3 inline mr-1" />Imágenes <span className="text-rose-400">*</span>
                                    <span className="ml-1 text-slate-300 font-normal normal-case">Mín. 1 — la primera es la imagen principal</span>
                                </label>

                                {/* Sugerencias del artículo */}
                                {preloadedSuggestions.length > 0 && images.length === 0 && (
                                    <div className="mb-2 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                                        <p className="text-[10px] font-bold text-indigo-400 uppercase mb-2">Imágenes del artículo (haz clic para agregar)</p>
                                        <div className="flex flex-wrap gap-2">
                                            {preloadedSuggestions.map((url, i) => (
                                                <button
                                                    key={i}
                                                    onClick={() => addSuggestion(url)}
                                                    title={url}
                                                    className="group relative w-12 h-12 rounded-md overflow-hidden border border-indigo-200 hover:border-indigo-500 transition-all"
                                                >
                                                    <img src={url} alt="" className="w-full h-full object-cover" onError={e => (e.currentTarget.src = '')} />
                                                    <div className="absolute inset-0 bg-indigo-600/0 group-hover:bg-indigo-600/20 transition-all flex items-center justify-center">
                                                        <Plus className="w-4 h-4 text-white opacity-0 group-hover:opacity-100" />
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Lista de imágenes seleccionadas */}
                                {images.length > 0 && (
                                    <div className="space-y-1.5 mb-2">
                                        {images.map((url, i) => (
                                            <div key={i} id={`publish-image-${i}`} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200 group">
                                                {/* Thumbnail */}
                                                <div className="w-10 h-10 rounded-md overflow-hidden shrink-0 border border-slate-200 bg-white">
                                                    <img src={url} alt="" className="w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
                                                </div>
                                                {/* Orden badge */}
                                                <span className="text-xs font-black text-slate-300 w-5 shrink-0">#{i + 1}</span>
                                                {/* URL truncada */}
                                                <span className="flex-1 text-xs text-slate-500 truncate font-mono">{url}</span>
                                                {/* Controles */}
                                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button onClick={() => moveImage(i, -1)} disabled={i === 0} className="p-1 rounded hover:bg-slate-200 disabled:opacity-30" title="Subir">
                                                        <ArrowUp className="w-3 h-3" />
                                                    </button>
                                                    <button onClick={() => moveImage(i, 1)} disabled={i === images.length - 1} className="p-1 rounded hover:bg-slate-200 disabled:opacity-30" title="Bajar">
                                                        <ArrowDown className="w-3 h-3" />
                                                    </button>
                                                    <button onClick={() => removeImage(i)} className="p-1 rounded hover:bg-rose-100 text-rose-400" title="Eliminar">
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Input URL nueva */}
                                <div className="flex gap-2">
                                    <input
                                        id="publish-image-url-input"
                                        type="url"
                                        value={newImageUrl}
                                        onChange={e => { setNewImageUrl(e.target.value); setImgInputError(null); }}
                                        onKeyDown={e => e.key === 'Enter' && addImage()}
                                        placeholder="https://... URL pública de la imagen"
                                        className={cn(
                                            "flex-1 px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 bg-white",
                                            imgInputError
                                                ? "border-rose-300 focus:ring-rose-400"
                                                : "border-slate-200 focus:ring-yellow-400"
                                        )}
                                    />
                                    <button
                                        id="publish-add-image-btn"
                                        onClick={addImage}
                                        className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-bold transition-colors flex items-center gap-1"
                                    >
                                        <Plus className="w-4 h-4" /> Agregar
                                    </button>
                                </div>
                                {imgInputError && <p className="text-xs text-rose-500 mt-1">{imgInputError}</p>}
                            </div>

                            {/* Error general */}
                            {errorMsg && (
                                <div className="flex items-center gap-2 p-3 bg-rose-50 rounded-lg border border-rose-200">
                                    <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                                    <p className="text-xs text-rose-700 font-medium">{errorMsg}</p>
                                </div>
                            )}

                            {/* CTA — Preview */}
                            <button
                                id="publish-preview-btn"
                                onClick={handlePreview}
                                disabled={loading || !selectedAccount || images.length === 0}
                                className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-sm"
                            >
                                {loading
                                    ? <Loader2 className="w-4 h-4 animate-spin" />
                                    : <Eye className="w-4 h-4" />
                                }
                                {loading ? 'Procesando...' : 'Ver preview antes de publicar'}
                            </button>
                        </>
                    )}

                    {/* -- ETAPA 2: PREVIEW (dry_run) ------------------------ */}
                    {stage === 'preview' && previewResult && (
                        <>
                            {/* 404 — artículo no encontrado */}
                            {previewResult.status === 404 && (
                                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl">
                                    <div className="flex items-center gap-2 mb-2">
                                        <XCircle className="w-5 h-5 text-rose-500" />
                                        <h3 className="font-bold text-rose-800 text-sm">Artículo no encontrado en BD</h3>
                                    </div>
                                    <p className="text-xs text-rose-700 mb-2">{previewResult.data.error}</p>
                                    {previewResult.data.trace?.input && (
                                        <p className="text-xs font-mono bg-rose-100 px-2 py-1 rounded text-rose-600">
                                            articulo_id enviado: <strong>{previewResult.data.trace.input.articulo_id}</strong>
                                        </p>
                                    )}
                                    <p className="text-xs text-rose-500 mt-2">Verifica que el artículo siga existiendo en el catálogo.</p>
                                </div>
                            )}

                            {/* 409 — duplicado */}
                            {previewResult.status === 409 && (
                                <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl">
                                    <div className="flex items-center gap-2 mb-2">
                                        <AlertCircle className="w-5 h-5 text-orange-500" />
                                        <h3 className="font-bold text-orange-800 text-sm">Ya existe una publicación activa para esta cuenta</h3>
                                    </div>
                                    <p className="text-xs text-orange-700 mb-3">{previewResult.data.error}</p>
                                    {previewResult.data.publicacion_existente && (
                                        <a
                                            href={`https://www.mercadolibre.com.mx/p/${previewResult.data.publicacion_existente}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-xs font-bold text-orange-600 hover:underline"
                                        >
                                            <ExternalLink className="w-3 h-3" />
                                            Ver {previewResult.data.publicacion_existente} en MeLi
                                        </a>
                                    )}
                                </div>
                            )}

                            {/* 422 — error de validación */}
                            {previewResult.status === 422 && (
                                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl">
                                    <div className="flex items-center gap-2 mb-2">
                                        <XCircle className="w-5 h-5 text-rose-500" />
                                        <h3 className="font-bold text-rose-800 text-sm">Error de validación</h3>
                                    </div>
                                    <p className="text-xs text-rose-700 mb-2">{previewResult.data.error}</p>
                                    {previewResult.data.errores?.map((e: string, i: number) => (
                                        <p key={i} className="text-xs text-rose-600 font-mono bg-rose-100 px-2 py-1 rounded mt-1">• {e}</p>
                                    ))}
                                    {previewResult.data.meli_error && (
                                        <div className="mt-3 p-3 bg-rose-100 rounded-lg border border-rose-300">
                                            <p className="text-[10px] font-bold uppercase text-rose-500 mb-1.5">Detalle de MeLi</p>
                                            {previewResult.data.meli_error.message && (
                                                <p className="text-xs font-bold text-rose-800 mb-1">{previewResult.data.meli_error.message}</p>
                                            )}
                                            {previewResult.data.meli_error.cause?.map((c: any, i: number) => (
                                                <p key={i} className="text-xs text-rose-700 font-mono bg-white px-2 py-1 rounded mt-1">[{c.code}] {c.message}</p>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* OK — preview editable */}
                            {previewResult.status === 200 && previewResult.data.ok && (() => {
                                const t = previewResult.data.trace;
                                const candidates: any[] = t?.paso_5_categoria?.candidates || t?.paso_5_categoria?.alternativas || [];
                                const curCatId = categoryOverride || t?.paso_5_categoria?.category_id || '';
                                const primaryOpt = {
                                    category_id:   t?.paso_5_categoria?.category_id,
                                    category_name: t?.paso_5_categoria?.category_name,
                                    path:          t?.paso_5_categoria?.category_path || t?.paso_5_categoria?.category_name,
                                };
                                const allCatOptions = [
                                    primaryOpt,
                                    ...candidates.filter((a: any) => a.category_id !== t?.paso_5_categoria?.category_id),
                                ];
                                // Ruta a mostrar como display activo
                                const activePath = categoryOverride
                                    ? (catSelectedPath || categoryOverride)
                                    : (primaryOpt.path || primaryOpt.category_name || curCatId);
                                const reqAttrs: any[] = dynamicReqAttrs ?? (t?.paso_6_atributos?.required_detail || []);
                                const originalAttrs: any[] = t?.paso_8_attributes_final || [];
                                return (
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                                            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                                            <div>
                                                <p className="font-bold text-emerald-800 text-sm">Preview listo — revisa y confirma</p>
                                                <p className="text-xs text-emerald-600">Cuenta: <strong>{accountName}</strong>{t?.paso_3_precio?.sale_price ? <span> · Precio: <strong>{new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(t.paso_3_precio.sale_price)}</strong></span> : null}</p>
                                            </div>
                                        </div>
                                        {/* Categoría */}
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1.5"><Tag className="w-3 h-3 inline mr-1" />Categoría MeLi</label>
                                            {/* Ruta activa (auto-predicha o seleccionada) */}
                                            <div className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50">
                                                <span className="font-mono text-[10px] text-slate-400 mr-2">{curCatId}</span>
                                                <span className="text-slate-700">{activePath}</span>
                                            </div>
                                            {/* Select multi-opción solo si hay varias del dry-run */}
                                            {allCatOptions.length > 1 && (
                                                <select
                                                    value={curCatId}
                                                    onChange={e => { setCategoryOverride(e.target.value); setCatSelectedPath(''); }}
                                                    className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400 bg-white font-mono"
                                                >
                                                    {allCatOptions.map((opt: any) => opt?.category_id && (
                                                        <option key={opt.category_id} value={opt.category_id}>
                                                            {opt.category_id}{opt.path ? ` — ${opt.path}` : (opt.category_name ? ` — ${opt.category_name}` : '')}
                                                        </option>
                                                    ))}
                                                </select>
                                            )}

                                            {/* Buscador live */}
                                            <div className="relative mt-2">
                                                <div className="flex items-center gap-1 px-3 py-2 border border-slate-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-yellow-400">
                                                    <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                                    <input
                                                        id="cat-search-input"
                                                        type="text"
                                                        value={catSearch}
                                                        onChange={e => {
                                                            const val = e.target.value;
                                                            setCatSearch(val);
                                                            if (catSearchTimer.current) clearTimeout(catSearchTimer.current);
                                                            if (val.trim().length < 2) { setCatSearchResults([]); return; }
                                                            catSearchTimer.current = setTimeout(async () => {
                                                                setCatSearchLoading(true);
                                                                try {
                                                                    const r = await fetch(`/api/publish/category-search?q=${encodeURIComponent(val.trim())}&marketplace_id=${encodeURIComponent(selectedAccount || '')}`);
                                                                    const d = await r.json();
                                                                    setCatSearchResults(d.ok ? d.candidates : []);
                                                                } catch { setCatSearchResults([]); }
                                                                finally { setCatSearchLoading(false); }
                                                            }, 400);
                                                        }}
                                                        placeholder="Buscar categoría en MeLi (ej. dado métrico)"
                                                        className="flex-1 text-sm bg-transparent outline-none placeholder-slate-400"
                                                    />
                                                    {catSearchLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 shrink-0" />}
                                                </div>
                                                {catSearchResults.length > 0 && (
                                                    <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                                        {catSearchResults.map((c: any) => (
                                                            <button
                                                                key={c.category_id}
                                                                type="button"
                                                                onClick={() => {
                                                                    setCategoryOverride(c.category_id);
                                                                    setCatSelectedPath(c.path || c.category_name || c.category_id);
                                                                    setCatSearch('');
                                                                    setCatSearchResults([]);
                                                                }}
                                                                className="w-full text-left px-3 py-2 text-xs hover:bg-yellow-50 border-b border-slate-100 last:border-0"
                                                            >
                                                                <span className="font-mono font-bold text-slate-700 text-[10px]">{c.category_id}</span>
                                                                <span className="text-slate-600 ml-2">{c.path || c.category_name || ''}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            {/* Botón Re-ejecutar preview */}
                                            {categoryOverride && categoryOverride !== t?.paso_5_categoria?.category_id && (
                                                <button
                                                    id="re-preview-btn"
                                                    onClick={() => handleRePreview(categoryOverride)}
                                                    disabled={loading}
                                                    className="mt-2 w-full py-2 text-xs font-bold bg-blue-50 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors"
                                                >
                                                    {loading ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : '🔄'} Re-ejecutar preview con <span className="font-mono">{categoryOverride}</span>
                                                </button>
                                            )}
                                        </div>
                                        {/* Family name */}
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1.5">Family Name (título base)</label>
                                            <input type="text" value={familyNameOverride !== '' ? familyNameOverride : (t?.paso_8_ai?.family_name || '')} onChange={e => setFamilyNameOverride(e.target.value)} maxLength={60} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400 font-mono" />
                                        </div>
                                        {/* Dimensiones del paquete */}
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1.5"><Package className="w-3 h-3 inline mr-1" />Dimensiones del paquete</label>
                                            <div className="grid grid-cols-2 gap-2">
                                                {[
                                                    { id: 'SELLER_PACKAGE_HEIGHT', label: 'Alto',   unit: 'cm', traceKey: 'SELLER_PACKAGE_HEIGHT' },
                                                    { id: 'SELLER_PACKAGE_WIDTH',  label: 'Ancho',  unit: 'cm', traceKey: 'SELLER_PACKAGE_WIDTH'  },
                                                    { id: 'SELLER_PACKAGE_LENGTH', label: 'Largo',  unit: 'cm', traceKey: 'SELLER_PACKAGE_LENGTH' },
                                                    { id: 'SELLER_PACKAGE_WEIGHT', label: 'Peso',   unit: 'g',  traceKey: 'SELLER_PACKAGE_WEIGHT'  },
                                                ].map(({ id, label, unit, traceKey }) => {
                                                    const traceVal = t?.paso_7_package_dimensions?.[traceKey] ?? '';
                                                    const currentVal = dimOverrides[id] !== undefined ? dimOverrides[id] : traceVal;
                                                    const isEdited = dimOverrides[id] !== undefined && dimOverrides[id] !== traceVal;
                                                    return (
                                                        <div key={id} className="relative">
                                                            <label className="text-[9px] uppercase text-slate-400 font-bold">{label}</label>
                                                            <div className="flex items-center border border-slate-200 rounded-lg bg-white overflow-hidden focus-within:ring-2 focus-within:ring-yellow-400">
                                                                <input
                                                                    type="text"
                                                                    value={currentVal}
                                                                    onChange={e => setDimOverrides(prev => ({ ...prev, [id]: e.target.value }))}
                                                                    placeholder={`ej. 10 ${unit}`}
                                                                    className="flex-1 px-2 py-1.5 text-xs font-mono bg-transparent outline-none"
                                                                />
                                                                <span className="text-[9px] text-slate-400 px-2 border-l border-slate-100">{unit}</span>
                                                            </div>
                                                            {isEdited && <span className="text-[8px] text-blue-500 absolute right-0 top-0">editado</span>}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <p className="text-[9px] text-slate-400 mt-1">Valores actuales del artículo. Edítalos si MeLi los rechazó. Formato: número espacio unidad (ej. &quot;10 cm&quot;, &quot;500 g&quot;)</p>
                                        </div>
                                        {/* Atributos requeridos */}
                                        {loadingAttrs ? (
                                            <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-700">
                                                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                                Cargando atributos de la nueva categoría...
                                            </div>
                                        ) : reqAttrs.length > 0 && (
                                            <div>
                                                <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-2">Atributos requeridos ({reqAttrs.length})</label>
                                                <div className="space-y-2">
                                                    {reqAttrs.map((attr: any) => {
                                                        const ov = attrOverrides[attr.id];
                                                        // Fuente de valores: currentAttrValues si hay cambio de categoría, original trace si no
                                                        const curVal = dynamicReqAttrs
                                                            ? (currentAttrValues.get(attr.id) ?? null)
                                                            : (originalAttrs.find((a: any) => a.id === attr.id) ?? null);
                                                        const valId = ov?.value_id ?? curVal?.value_id ?? '';
                                                        const valName = ov?.value_name ?? curVal?.value_name ?? '';
                                                        const isMissing = !curVal && !ov;
                                                        return (
                                                            <div key={attr.id} className={cn('p-2.5 rounded-lg border', isMissing ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50')}>
                                                                <div className="flex items-center justify-between mb-1.5">
                                                                    <span className="text-xs font-bold text-slate-700">{attr.name}</span>
                                                                    <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase', ov ? 'bg-blue-100 text-blue-700' : isMissing ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700')}>{ov ? 'Editado' : isMissing ? 'Faltante' : 'Auto'}</span>
                                                                </div>
                                                                {attr.values?.length > 0 ? (
                                                                    <select value={valId} onChange={e => { const opt = attr.values.find((v: any) => v.id === e.target.value); setAttrOverrides(prev => ({ ...prev, [attr.id]: { value_id: e.target.value, value_name: opt?.name } })); }} className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-yellow-400">
                                                                        <option value="">— Seleccionar —</option>
                                                                        {attr.values.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
                                                                    </select>
                                                                ) : (
                                                                    <input type="text" value={valName} onChange={e => setAttrOverrides(prev => ({ ...prev, [attr.id]: { value_name: e.target.value } }))} placeholder={`Ingresa ${attr.name}`} className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-yellow-400 font-mono" />
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                        {/* Trace */}
                                        <TraceBlock trace={t || {}} />
                                        {/* CTAs */}
                                        <div className="flex gap-3">
                                            <button id="publish-back-btn" onClick={resetPanel} className="flex-1 py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold rounded-xl text-sm transition-colors">Volver</button>
                                            <button id="publish-confirm-btn" onClick={handlePublish} disabled={loading} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-bold rounded-xl text-sm transition-colors shadow-sm disabled:opacity-50">
                                                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                                {loading ? 'Publicando...' : 'Publicar con estos datos'}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Si fue error, volver */}
                            {(previewResult.status === 404 || previewResult.status === 409 || previewResult.status === 422) && (
                                <button
                                    onClick={resetPanel}
                                    className="w-full py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold rounded-xl text-sm transition-colors"
                                >
                                    <RefreshCw className="w-4 h-4 inline mr-1" />
                                    Volver a configurar
                                </button>
                            )}

                            {/* Si el trace existe pero el status no es 200/409/422/404 */}
                            {previewResult.status >= 500 && (
                                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg space-y-2">
                                    <p className="text-xs text-rose-700 font-bold">Error del servidor: {previewResult.data.error}</p>

                                    {previewResult.data.trace && <TraceBlock trace={previewResult.data.trace} />}
                                    <button onClick={resetPanel} className="mt-2 text-xs text-rose-500 underline">Volver</button>
                                </div>
                            )}
                        </>
                    )}

                    {/* -- ETAPA 3: RESULTADO FINAL --------------------------- */}
                    {stage === 'result' && publishResult && (
                        <div className="space-y-3">
                            {/* Éxito */}
                            {publishResult.status === 200 && publishResult.data.ok && (
                                <div className="p-5 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
                                    <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                                    <h3 className="font-bold text-emerald-800 text-base mb-1">¡Publicación exitosa!</h3>
                                    <p className="text-sm font-mono font-bold text-emerald-700 mb-3">
                                        {publishResult.data.item_id}
                                    </p>
                                    <p className="text-xs text-emerald-600 mb-3">
                                        Título generado: <span className="font-bold">{publishResult.data.title}</span>
                                    </p>
                                    {publishResult.data.permalink && (
                                        <a
                                            href={publishResult.data.permalink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1.5 px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-bold rounded-lg text-sm transition-colors"
                                        >
                                            <ExternalLink className="w-4 h-4" />
                                            Ver en MeLi
                                        </a>
                                    )}
                                </div>
                            )}

                            {/* 409 en publicación real (raro si pasó el preview, pero posible) */}
                            {publishResult.status === 409 && (
                                <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl">
                                    <div className="flex items-center gap-2 mb-1">
                                        <AlertCircle className="w-4 h-4 text-orange-500" />
                                        <h3 className="font-bold text-orange-800 text-sm">Publicación duplicada — ya existe una activa</h3>
                                    </div>
                                    <p className="text-xs text-orange-700">{publishResult.data.error}</p>
                                    {publishResult.data.publicacion_existente && (
                                        <a
                                            href={`https://www.mercadolibre.com.mx/p/${publishResult.data.publicacion_existente}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-xs font-bold text-orange-600 hover:underline mt-2"
                                        >
                                            <ExternalLink className="w-3 h-3" />
                                            Ver {publishResult.data.publicacion_existente}
                                        </a>
                                    )}
                                </div>
                            )}

                            {/* Error genérico */}
                            {!publishResult.data.ok && publishResult.status !== 409 && (
                                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl">
                                    <div className="flex items-center gap-2 mb-1">
                                        <XCircle className="w-4 h-4 text-rose-500" />
                                        <h3 className="font-bold text-rose-800 text-sm">Error al publicar</h3>
                                    </div>
                                    <p className="text-xs text-rose-700">{publishResult.data.error}</p>
                                    {publishResult.data.errores?.map((e: string, i: number) => (
                                        <p key={i} className="text-xs text-rose-600 font-mono bg-rose-100 px-2 py-1 rounded mt-1">• {e}</p>
                                    ))}
                                    {publishResult.data.meli_error && (
                                        <div className="mt-3 p-3 bg-rose-100 rounded-lg border border-rose-300">
                                            <p className="text-[10px] font-bold uppercase text-rose-500 mb-1.5">Detalle de rechazo MeLi</p>
                                            {publishResult.data.meli_error.message && (
                                                <p className="text-xs font-bold text-rose-800 mb-1">{publishResult.data.meli_error.message}</p>
                                            )}
                                            {publishResult.data.meli_error.cause?.map((c: any, i: number) => (
                                                <p key={i} className="text-xs text-rose-700 font-mono bg-white px-2 py-1 rounded mt-1">[{c.code}] {c.message}</p>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Trace colapsado */}
                            {publishResult.data.trace && <TraceBlock trace={publishResult.data.trace} />}

                            {/* Botones de acción post-resultado */}
                            {!publishResult.data.ok && publishResult.status !== 409 ? (
                                <div className="flex gap-3">
                                    <button
                                        id="publish-result-back-edit-btn"
                                        onClick={() => setStage('preview')}
                                        className="flex-1 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-50 font-bold rounded-xl text-sm transition-colors"
                                    >
                                        <RefreshCw className="w-4 h-4 inline mr-1" />
                                        Volver a editar
                                    </button>
                                    <button
                                        id="publish-result-reset-btn"
                                        onClick={resetPanel}
                                        className="flex-1 py-2.5 border border-slate-200 text-slate-500 hover:bg-slate-50 font-bold rounded-xl text-sm transition-colors"
                                    >
                                        Nueva publicación
                                    </button>
                                </div>
                            ) : (
                                <button
                                    id="publish-result-new-btn"
                                    onClick={resetPanel}
                                    className="w-full py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold rounded-xl text-sm transition-colors"
                                >
                                    <RefreshCw className="w-4 h-4 inline mr-1" />
                                    Nueva publicación
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
