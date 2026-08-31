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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

// Convierte una ruta relativa de Storage ("Bucket/file.jpg") a URL pública.
// Las imágenes de articulos.imagenes llegan como rutas relativas, no http.
function getPublicImageUrl(rawPath: string | null | undefined): string | null {
    if (!rawPath) return null;
    if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) return rawPath;
    const slashIndex = rawPath.indexOf('/');
    if (slashIndex === -1) return null;
    const bucket = rawPath.substring(0, slashIndex);
    const filePath = rawPath.substring(slashIndex + 1);
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encodeURIComponent(filePath)}`;
}

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
    /** Código universal (EAN/UPC/GTIN) para búsqueda en catálogo MeLi */
    codigoUniversal?: string;
}

// -- Helpers ------------------------------------------------------------------
function TraceBlock({ trace }: { trace: Record<string, any> }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="mt-3 border border-[var(--border)] rounded-lg overflow-hidden">
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-[var(--text-muted)] bg-[var(--bg)] hover:bg-[var(--surface-2)] transition-colors"
            >
                <span>Ver trace técnico</span>
                {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {open && (
                <pre className="text-[10px] leading-relaxed text-[var(--text-muted)] bg-[var(--bg)] p-3 overflow-auto max-h-80 whitespace-pre-wrap break-all">
                    {JSON.stringify(trace, null, 2)}
                </pre>
            )}
        </div>
    );
}

// -- Stepper transparente: convierte el trace en pasos legibles ---------------
function PublishStepper({ trace }: { trace: Record<string, any> }) {
    const fmtMXN = (n: any) => n != null && !isNaN(Number(n))
        ? `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
        : '—';

    const steps: Array<{ label: string; detail: string; tone: 'ok' | 'warn' | 'neutral' }> = [
        {
            label: 'Artículo',
            detail: trace?.paso_1_articulo
                ? (`${trace.paso_1_articulo.marca || ''} ${trace.paso_1_articulo.nombre || ''}`.trim() || trace.paso_1_articulo.articulo_id)
                : '—',
            tone: 'ok',
        },
        {
            label: 'Cuenta',
            detail: trace?.paso_2_seller_model
                ? `${trace.paso_2_seller_model.nickname || 'cuenta'} · ${trace.paso_2_seller_model.model === 'up' ? 'User Products' : 'Legacy'}`
                : '—',
            tone: 'neutral',
        },
        {
            label: 'Precio',
            detail: trace?.paso_9_titulo?.price_final != null
                ? `${fmtMXN(trace.paso_9_titulo.price_final)} · ${trace.paso_9_titulo.price_source || '—'}`
                : (trace?.paso_3_precio?.sale_price != null ? fmtMXN(trace.paso_3_precio.sale_price) : '—'),
            tone: (Number(trace?.paso_9_titulo?.price_final ?? trace?.paso_3_precio?.sale_price ?? 0) > 0) ? 'ok' : 'warn',
        },
        {
            label: 'Categoría',
            detail: trace?.paso_5_categoria?.category_path || trace?.paso_5_categoria?.category_name || '—',
            tone: trace?.paso_5_categoria?.category_id ? 'ok' : 'warn',
        },
        {
            label: 'Atributos',
            detail: (() => {
                const total = trace?.paso_6_atributos?.total;
                const faltan = trace?.paso_8_atributos_aun_faltantes?.length ?? 0;
                return total != null ? `${total} de categoría · ${faltan} faltantes` : '—';
            })(),
            tone: (trace?.paso_8_atributos_aun_faltantes?.length ?? 0) === 0 ? 'ok' : 'warn',
        },
        {
            label: 'Título',
            detail: trace?.paso_9_titulo?.title_legacy || trace?.paso_9_titulo?.family_name_up || '—',
            tone: 'neutral',
        },
    ];

    if (trace?.paso_12_meli_create) {
        steps.push({
            label: 'Publicación',
            detail: `${trace.paso_12_meli_create.item_id} · ${trace.paso_12_meli_create.status}`,
            tone: 'ok',
        });
    }

    return (
        <ol className="mt-3 space-y-1.5 border-t border-[var(--border)] pt-3">
            {steps.map((s, i) => (
                <li key={s.label} className="flex items-start gap-2.5 text-xs">
                    <span className="w-5 h-5 shrink-0 rounded-full bg-[var(--surface-2)] flex items-center justify-center text-[10px] font-bold text-[var(--text-faint)] tabular-nums">
                        {i + 1}
                    </span>
                    <span className="flex-1 min-w-0">
                        <span className="font-semibold text-[var(--text)]">{s.label}:</span>{' '}
                        <span className={s.tone === 'ok' ? 'text-[var(--ok)]' : s.tone === 'warn' ? 'text-[var(--warn)]' : 'text-[var(--text-muted)]'}>
                            {s.detail}
                        </span>
                    </span>
                </li>
            ))}
        </ol>
    );
}

// -- Componente principal ------------------------------------------------------
export function PublishPanel({ articulo_id, nombreArticulo, ficha_id, imagenesBase = [], modalMode = false, codigoUniversal = '' }: PublishPanelProps) {
    // Cuentas
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
    const primaryAccount = selectedAccounts[0] || '';

    // Config
    const [categoryId, setCategoryId] = useState('');
    const [listingType, setListingType] = useState('gold_special');

    // Imágenes
    const [images, setImages] = useState<string[]>([]);
    const [newImageUrl, setNewImageUrl] = useState('');
    const [extractUrl, setExtractUrl] = useState('');
    const [extracting, setExtracting] = useState(false);
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
    const [priceOverride, setPriceOverride] = useState<string>('');
    const [stockOverride, setStockOverride] = useState<string>('');
    const [descriptionOverride, setDescriptionOverride] = useState<string>('');
    const [freeShipping, setFreeShipping] = useState(false);
    const [shippingMode, setShippingMode] = useState('me2');
    const [manufacturingDays, setManufacturingDays] = useState<string>('');
    const [catalogResults, setCatalogResults] = useState<any[]>([]);
    const [catalogProductId, setCatalogProductId] = useState<string | null>(null);
    const [catalogListing, setCatalogListing] = useState(false);
    const [searchingCatalog, setSearchingCatalog] = useState(false);
    const [forceDuplicate, setForceDuplicate] = useState(false);
    // Atributos dinámicos al cambiar de categoría
    const [dynamicReqAttrs, setDynamicReqAttrs] = useState<any[] | null>(null);
    const [dynamicOptAttrs, setDynamicOptAttrs] = useState<any[] | null>(null);
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

    // Datos propios del artículo (para la comparativa catálogo vs propio)
    const [articleData, setArticleData] = useState<any>(null);

    // -- Cargar cuentas ------------------------------------------------------
    useEffect(() => {
        supabase
            .from('marketplace_configs')
            .select('id, account_name')
            .eq('is_active', true)
            .then(({ data }) => {
                setAccounts(data || []);
                // Auto-seleccionar la primera cuenta por defecto
                if (data && data.length > 0) setSelectedAccounts([data[0].id]);
            });
    }, []);

    // Pre-cargar sugerencias de imágenes del artículo (convierte rutas relativas a públicas).
    // NO auto-agregar: si el artículo no tiene fotos, el campo queda vacío para subir manualmente.
    useEffect(() => {
        const validUrls = imagenesBase
            .map(getPublicImageUrl)
            .filter((u): u is string => !!u);
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

    // Datos propios del artículo: para la comparativa catálogo vs propio
    useEffect(() => {
        if (!articulo_id) return;
        let cancelled = false;
        supabase
            .from('articulos')
            .select('nombre, marca, modelo, variante, categoria, codigo_universal, peso_kg, largo_cm, ancho_cm, alto_cm, descripcion')
            .eq('articulo_id', articulo_id)
            .single()
            .then(({ data }) => { if (!cancelled && data) setArticleData(data); })
            .catch(() => { /* silencioso */ });
        return () => { cancelled = true; };
    }, [articulo_id]);

    // Re-fetch atributos requeridos cuando el usuario cambia la categoría en el preview
    useEffect(() => {
        if (!categoryOverride || !primaryAccount || stage !== 'preview') {
            setDynamicReqAttrs(null);
            setDynamicOptAttrs(null);
            setCurrentAttrValues(new Map());
            return;
        }
        const originalCat = previewResult?.data?.trace?.paso_5_categoria?.category_id;
        if (categoryOverride === originalCat) {
            setDynamicReqAttrs(null);
            setDynamicOptAttrs(null);
            setCurrentAttrValues(new Map());
            return;
        }
        // Categoría diferente: limpiar estado anterior y recargar
        setDynamicReqAttrs(null);
        setDynamicOptAttrs(null);
        setAttrOverrides({});
        setCurrentAttrValues(new Map());
        setLoadingAttrs(true);
        const originalAttrs: any[] = previewResult?.data?.trace?.paso_8_attributes_final || [];
        fetch(`/api/publish/attributes?category_id=${encodeURIComponent(categoryOverride)}&marketplace_id=${encodeURIComponent(primaryAccount)}`)
            .then(r => r.json())
            .then(data => {
                if (data.ok) {
                    setDynamicReqAttrs(data.required);
                    setDynamicOptAttrs(data.optional || []);
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
    }, [categoryOverride, primaryAccount, stage]);

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

    // Extraer imágenes de una página de producto (galería del fabricante / web)
    async function extractImagesFromUrl() {
        const url = extractUrl.trim();
        if (!url.startsWith('http')) { setImgInputError('Pega una URL válida (http...)'); return; }
        setExtracting(true);
        setImgInputError(null);
        try {
            const res = await fetch('/api/publish/extract-images', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });
            const data = await res.json();
            if (data.ok && data.imagenes?.length) {
                setImages(prev => {
                    const existing = new Set(prev);
                    const added = data.imagenes.map((i: any) => i.url).filter((u: string) => !existing.has(u));
                    return [...prev, ...added];
                });
                setExtractUrl('');
            } else {
                setImgInputError(data.advertencia || data.error || 'No se encontraron imágenes');
            }
        } catch (e: any) {
            setImgInputError(e.message || 'Error extrayendo imágenes');
        } finally {
            setExtracting(false);
        }
    }

    // Completar título + descripción con IA a partir de los datos del producto
    async function completeWithAI() {
        setLoading(true);
        setErrorMsg(null);
        try {
            const res = await fetch('/api/publish/ai-complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ articulo_id }),
            });
            const data = await res.json();
            if (data.ok) {
                if (data.title) setFamilyNameOverride(data.title);
                if (data.description) setDescriptionOverride(data.description);
            } else {
                setErrorMsg(data.error || 'Error generando contenido con IA');
            }
        } catch (e: any) {
            setErrorMsg(e.message || 'Error de red al llamar a la IA');
        } finally {
            setLoading(false);
        }
    }

    // Buscar producto en el catálogo de MeLi por GTIN/EAN
    async function searchCatalogByGtin() {
        if (!primaryAccount) { setErrorMsg('Selecciona una cuenta MeLi primero'); return; }
        if (!codigoUniversal) { setErrorMsg('Este artículo no tiene código universal (GTIN/EAN) para buscar en catálogo'); return; }
        setSearchingCatalog(true);
        setErrorMsg(null);
        try {
            const res = await fetch('/api/publish/catalog-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gtin: codigoUniversal, marketplace_id: primaryAccount }),
            });
            const data = await res.json();
            if (data.ok && data.encontrado) {
                setCatalogResults(data.resultados);
            } else if (data.ok && !data.encontrado) {
                setCatalogResults([]);
                setErrorMsg('No se encontró producto en el catálogo para este GTIN. Publica como tradicional.');
            } else {
                setErrorMsg(data.error || 'Error buscando en el catálogo');
            }
        } catch (e: any) {
            setErrorMsg(e.message || 'Error de red al buscar en catálogo');
        } finally {
            setSearchingCatalog(false);
        }
    }

    function usarCatalog(r: any) {
        setCatalogProductId(r.catalog_product_id);
        setCatalogListing(true);
        setCatalogResults([]);
    }

    function omitirCatalog() {
        setCatalogProductId(null);
        setCatalogListing(false);
        setCatalogResults([]);
    }

    // -- Preview (dry_run) ----------------------------------------------------
    async function handlePreview() {
        if (!primaryAccount) { setErrorMsg('Selecciona una cuenta MeLi'); return; }
        setErrorMsg(null);
        setLoading(true);
        setPreviewResult(null);
        try {
            const res = await fetch('/api/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    articulo_id,
                    marketplace_id: primaryAccount,
                    pictures: images,
                    ...(ficha_id ? { ficha_id } : {}),
                    category_id: categoryId || undefined,
                    listing_type_id: listingType,
                    dry_run: true,
                    ...(catalogListing && catalogProductId ? { catalog_product_id: catalogProductId, catalog_listing: true } : {}),
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
        if (!primaryAccount || !forcedCategoryId) return;
        setLoading(true);
        setErrorMsg(null);
        try {
            const res = await fetch('/api/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    articulo_id,
                    marketplace_id: primaryAccount,
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

    // -- Publicar real (a todas las cuentas seleccionadas) ------------------
    async function handlePublish() {
        if (selectedAccounts.length === 0) { setErrorMsg('Selecciona al menos una cuenta'); return; }
        setLoading(true);
        setErrorMsg(null);
        try {
            const attrOvList = Object.entries(attrOverrides).map(([id, v]) => ({ id, ...v }));
            const dimOvList = Object.entries(dimOverrides)
                .filter(([, v]) => v.trim() !== '')
                .map(([id, v]) => ({ id, value_name: v.trim() }));
            const allOverrides = [...attrOvList, ...dimOvList];

            const results: any[] = [];
            for (const accountId of selectedAccounts) {
                const nombreCuenta = accounts.find(a => a.id === accountId)?.account_name || accountId;
                try {
                    const res = await fetch('/api/publish', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            articulo_id,
                            marketplace_id: accountId,
                            pictures: images,
                            ...(ficha_id ? { ficha_id } : {}),
                            category_id: categoryOverride || categoryId || undefined,
                            listing_type_id: listingType,
                            dry_run: false,
                            ...(allOverrides.length > 0 ? { attribute_overrides: allOverrides } : {}),
                            ...(familyNameOverride ? { family_name_override: familyNameOverride } : {}),
                            ...(priceOverride && Number(priceOverride) > 0 ? { price_override: Number(priceOverride) } : {}),
                    ...(stockOverride !== '' && Number(stockOverride) >= 0 ? { stock_override: Number(stockOverride) } : {}),
                            ...(descriptionOverride.trim() ? { description_override: descriptionOverride.trim() } : {}),
                            free_shipping: freeShipping,
                            shipping_mode: shippingMode,
                            manufacturing_time_days: manufacturingDays !== '' ? Number(manufacturingDays) : null,
                            ...(catalogListing && catalogProductId ? { catalog_product_id: catalogProductId, catalog_listing: true } : {}),
                            ...(forceDuplicate ? { force_duplicate: true } : {}),
                        }),
                    });
                    const data = await res.json();
                    results.push({ account_name: nombreCuenta, status: res.status, ok: !!data.ok, item_id: data.item_id, permalink: data.permalink, error: data.error, errores: data.errores, meli_error: data.meli_error, meli_message: data.meli_message });
                } catch (e: any) {
                    results.push({ account_name: nombreCuenta, status: 0, ok: false, error: e.message });
                }
            }
            setPublishResult({ status: 'multi', data: { results } });
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
        setPriceOverride('');
        setStockOverride('');
        setDescriptionOverride('');
        setExtractUrl('');
        setCatalogResults([]);
        setCatalogProductId(null);
        setCatalogListing(false);
        setForceDuplicate(false);
        setCurrentAttrValues(new Map());
        setDimOverrides({});
        setCatSearch('');
        setCatSearchResults([]);
        setCatSelectedPath('');
    }

    const accountName = selectedAccounts
        .map(id => accounts.find(a => a.id === id)?.account_name || id)
        .join(', ');

    function toggleAccount(id: string) {
        setSelectedAccounts(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    }

    // -- Render -------------------------------------------------------
    // En modalMode (desde fichas), el panel arranca abierto directamente
    const isOpen = modalMode ? true : panelOpen;

    return (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-sm overflow-hidden">
            {/* Header — toggle del panel (se oculta en modalMode) */}
            {!modalMode && (
                <button
                    id="publish-panel-toggle"
                    onClick={() => setPanelOpen(o => !o)}
                    className="w-full flex items-center justify-between px-6 py-4 hover:bg-[var(--bg)] transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-yellow-100 rounded-lg">
                            <Send className="w-4 h-4 text-yellow-600" />
                        </div>
                        <div className="text-left">
                            <h2 className="text-base font-bold text-[var(--text)]">Publicar en MeLi</h2>
                            <p className="text-xs text-[var(--text-faint)] mt-0.5">
                                Modelo User Products · Aprobación manual requerida
                                {ficha_id && <span className="ml-2 px-1.5 py-0.5 bg-[var(--accent)]/20 text-indigo-700 rounded text-[9px] font-bold">Datos desde ficha técnica</span>}
                            </p>
                        </div>
                    </div>
                    {panelOpen
                        ? <ChevronUp className="w-5 h-5 text-[var(--text-faint)]" />
                        : <ChevronDown className="w-5 h-5 text-[var(--text-faint)]" />
                    }
                </button>
            )}

            {isOpen && (
                <div className={`${!modalMode ? 'border-t border-[var(--border)]' : ''} px-6 py-5 space-y-5`}>
                    {/* Badge de ficha en modal mode */}
                    {modalMode && ficha_id && (
                        <div className="flex items-center gap-2 p-2.5 bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded-xl">
                            <span className="text-xs font-bold text-indigo-700">📄 Publicando con datos de la ficha técnica</span>
                            <span className="text-[10px] text-indigo-400 font-mono">{ficha_id.slice(0, 8)}…</span>
                        </div>
                    )}

                    {/* -- ETAPA 1: CONFIGURACIÓN ------------------------ */}
                    {stage === 'config' && (
                        <>
                            {/* Cuentas (multi-selección) */}
                            <div>
                                <label className="text-[10px] font-bold uppercase text-[var(--text-faint)] tracking-wider block mb-1.5">
                                    <Store className="w-3 h-3 inline mr-1" />Cuentas de destino <span className="text-rose-400">*</span>
                                    <span className="ml-1 font-normal normal-case text-[var(--text-faint)]">puedes publicar en varias a la vez</span>
                                </label>
                                <div className="space-y-1.5">
                                    {accounts.map(a => (
                                        <label key={a.id} className="flex items-center gap-2 p-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] cursor-pointer hover:border-[var(--accent)]/50">
                                            <input
                                                type="checkbox"
                                                checked={selectedAccounts.includes(a.id)}
                                                onChange={() => toggleAccount(a.id)}
                                                className="w-4 h-4 rounded text-[var(--accent)] focus:ring-[var(--accent)]"
                                            />
                                            <span className="text-sm text-[var(--text)]">{a.account_name}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Tipo de listado */}
                            <div>
                                <label className="text-[10px] font-bold uppercase text-[var(--text-faint)] tracking-wider block mb-1.5">
                                    Tipo de listado
                                </label>
                                <select
                                    id="publish-listing-type"
                                    value={listingType}
                                    onChange={e => setListingType(e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400 bg-[var(--surface)]"
                                >
                                    <option value="gold_special">Gold Special (recomendado)</option>
                                    <option value="gold_pro">Gold Pro</option>
                                    <option value="silver">Silver</option>
                                    <option value="free">Free</option>
                                </select>
                            </div>

                            {/* Error general */}
                            {errorMsg && (
                                <div className="flex items-center gap-2 p-3 bg-[var(--err)]/10 rounded-lg border border-[var(--err)]/30">
                                    <AlertCircle className="w-4 h-4 text-[var(--err)] shrink-0" />
                                    <p className="text-xs text-[var(--err)] font-medium">{errorMsg}</p>
                                </div>
                            )}

                            {/* CTA — Preview */}
                            <button
                                id="publish-preview-btn"
                                onClick={handlePreview}
                                disabled={loading || selectedAccounts.length === 0}
                                className="w-full flex items-center justify-center gap-2 py-3 bg-[var(--accent)] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed text-[var(--accent-ink)] font-bold rounded-xl transition-all shadow-sm"
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
                                <div className="p-4 bg-[var(--err)]/10 border border-[var(--err)]/30 rounded-xl">
                                    <div className="flex items-center gap-2 mb-2">
                                        <XCircle className="w-5 h-5 text-[var(--err)]" />
                                        <h3 className="font-bold text-rose-800 text-sm">Artículo no encontrado en BD</h3>
                                    </div>
                                    <p className="text-xs text-[var(--err)] mb-2">{previewResult.data.error}</p>
                                    {previewResult.data.trace?.input && (
                                        <p className="text-xs font-mono bg-rose-100 px-2 py-1 rounded text-[var(--err)]">
                                            articulo_id enviado: <strong>{previewResult.data.trace.input.articulo_id}</strong>
                                        </p>
                                    )}
                                    <p className="text-xs text-[var(--err)] mt-2">Verifica que el artículo siga existiendo en el catálogo.</p>
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
                                <div className="p-4 bg-[var(--err)]/10 border border-[var(--err)]/30 rounded-xl">
                                    <div className="flex items-center gap-2 mb-2">
                                        <XCircle className="w-5 h-5 text-[var(--err)]" />
                                        <h3 className="font-bold text-rose-800 text-sm">Error de validación</h3>
                                    </div>
                                    <p className="text-xs text-[var(--err)] mb-2">{previewResult.data.error}</p>
                                    {previewResult.data.errores?.map((e: string, i: number) => (
                                        <p key={i} className="text-xs text-[var(--err)] font-mono bg-rose-100 px-2 py-1 rounded mt-1">• {e}</p>
                                    ))}
                                    {previewResult.data.meli_error && (
                                        <div className="mt-3 p-3 bg-rose-100 rounded-lg border border-rose-300">
                                            <p className="text-[10px] font-bold uppercase text-[var(--err)] mb-1.5">Detalle de MeLi</p>
                                            {previewResult.data.meli_error.message && (
                                                <p className="text-xs font-bold text-rose-800 mb-1">{previewResult.data.meli_error.message}</p>
                                            )}
                                            {previewResult.data.meli_error.cause?.map((c: any, i: number) => (
                                                <p key={i} className="text-xs text-[var(--err)] font-mono bg-[var(--surface)] px-2 py-1 rounded mt-1">[{c.code}] {c.message}</p>
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
                                        <div className="flex items-center gap-2 p-3 bg-[var(--ok)]/10 border border-[var(--ok)]/30 rounded-xl">
                                            <CheckCircle2 className="w-5 h-5 text-[var(--ok)] shrink-0" />
                                            <div>
                                                <p className="font-bold text-emerald-800 text-sm">Preview listo — revisa y confirma</p>
                                                <p className="text-xs text-[var(--ok)]">Cuenta: <strong>{accountName}</strong>{t?.paso_3_precio?.sale_price ? <span> · Precio: <strong>{new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(t.paso_3_precio.sale_price)}</strong></span> : null}</p>
                                            </div>
                                        </div>

                                        {/* Fotos — editar en el preview */}
                                        <div className="p-3 bg-[var(--surface-2)] rounded-lg border border-[var(--border)] space-y-2">
                                            <p className="text-[10px] font-bold uppercase text-[var(--text-faint)] tracking-wider">Fotos</p>
                                            {images.length > 0 && (
                                                <div className="space-y-1.5">
                                                    {images.map((url, i) => (
                                                        <div key={i} className="flex items-center gap-2 p-2 bg-[var(--bg)] rounded-lg border border-[var(--border)] group">
                                                            <div className="w-10 h-10 rounded-md overflow-hidden shrink-0 border border-[var(--border)] bg-[var(--surface)]">
                                                                <img src={url} alt="" className="w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
                                                            </div>
                                                            <span className="text-xs font-black text-[var(--text-faint)] w-5 shrink-0">#{i + 1}</span>
                                                            <span className="flex-1 text-xs text-[var(--text-muted)] truncate font-mono">{url}</span>
                                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <button onClick={() => moveImage(i, -1)} disabled={i === 0} className="p-1 rounded hover:bg-[var(--surface-2)] disabled:opacity-30" title="Subir"><ArrowUp className="w-3 h-3" /></button>
                                                                <button onClick={() => moveImage(i, 1)} disabled={i === images.length - 1} className="p-1 rounded hover:bg-[var(--surface-2)] disabled:opacity-30" title="Bajar"><ArrowDown className="w-3 h-3" /></button>
                                                                <button onClick={() => removeImage(i)} className="p-1 rounded hover:bg-[var(--err)]/10 text-[var(--err)]" title="Eliminar"><Trash2 className="w-3 h-3" /></button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            <div className="flex gap-2">
                                                <input type="url" value={newImageUrl} onChange={e => { setNewImageUrl(e.target.value); setImgInputError(null); }} onKeyDown={e => e.key === 'Enter' && addImage()} placeholder="https://... URL de imagen" className="flex-1 px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-yellow-400" />
                                                <button onClick={addImage} className="px-3 py-2 bg-[var(--surface)] text-[var(--accent-ink)] rounded-lg text-sm font-bold flex items-center gap-1"><Plus className="w-4 h-4" /> Agregar</button>
                                            </div>
                                            <div className="flex gap-2">
                                                <input type="url" value={extractUrl} onChange={e => { setExtractUrl(e.target.value); setImgInputError(null); }} onKeyDown={e => e.key === 'Enter' && extractImagesFromUrl()} placeholder="https://... página (extrae sus fotos)" className="flex-1 px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-yellow-400" />
                                                <button onClick={extractImagesFromUrl} disabled={extracting} className="px-3 py-2 bg-[var(--surface)] text-[var(--accent-ink)] rounded-lg text-sm font-bold flex items-center gap-1 disabled:opacity-50">{extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />} Extraer</button>
                                            </div>
                                            {imgInputError && <p className="text-xs text-[var(--err)]">{imgInputError}</p>}
                                        </div>

                                        {/* Catálogo — comparar con el producto */}
                                        <div className="p-3 bg-[var(--surface-2)] rounded-lg border border-[var(--border)] space-y-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="text-xs">
                                                    <p className="font-semibold text-[var(--text)]">Publicar en catálogo MeLi (opcional)</p>
                                                    <p className="text-[10px] text-[var(--text-faint)]">Compara tus datos con el catálogo antes de usarlo.</p>
                                                </div>
                                                <button type="button" onClick={searchCatalogByGtin} disabled={searchingCatalog || !codigoUniversal} className="shrink-0 px-3 py-1.5 text-xs font-bold text-[var(--accent)] bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded-[var(--radius-sm)] hover:bg-[var(--accent)]/20 disabled:opacity-50">
                                                    {searchingCatalog ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : 'Buscar por GTIN'}
                                                </button>
                                            </div>
                                            {catalogListing && catalogProductId && (
                                                <div className="flex items-center justify-between gap-2 text-xs bg-[var(--ok)]/10 border border-[var(--ok)]/30 rounded p-2">
                                                    <span className="text-[var(--ok)] font-semibold">Publicando en catálogo: {catalogProductId}</span>
                                                    <button type="button" onClick={omitirCatalog} className="text-[var(--err)] font-bold hover:underline">Omitir</button>
                                                </div>
                                            )}
                                            {catalogResults.length > 0 && (
                                                <div className="space-y-2 max-h-72 overflow-y-auto">
                                                    {catalogResults.map((r: any) => {
                                                        const catA = (id: string) => (r.atributos || []).find((a: any) => a.id === id)?.value_name || null;
                                                        const norm = (s: any) => (s == null ? '' : String(s).trim().toLowerCase());
                                                        const toNum = (s: any) => { const m = String(s ?? '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
                                                        const rows = [
                                                            { label: 'Nombre', propio: articleData?.nombre || nombreArticulo, catalogo: r.titulo, numeric: false },
                                                            { label: 'Marca', propio: articleData?.marca, catalogo: catA('BRAND'), numeric: false },
                                                            { label: 'Modelo', propio: articleData?.modelo, catalogo: catA('MODEL'), numeric: false },
                                                            { label: 'GTIN/EAN', propio: articleData?.codigo_universal || codigoUniversal, catalogo: catA('GTIN') || catA('EAN'), numeric: false },
                                                            { label: 'Peso', propio: articleData?.peso_kg != null ? `${Math.round(articleData.peso_kg * 1000)} g` : null, catalogo: catA('PACKAGE_WEIGHT'), numeric: true },
                                                            { label: 'Largo', propio: articleData?.largo_cm != null ? `${Math.round(articleData.largo_cm)} cm` : null, catalogo: catA('PACKAGE_LENGTH'), numeric: true },
                                                            { label: 'Ancho', propio: articleData?.ancho_cm != null ? `${Math.round(articleData.ancho_cm)} cm` : null, catalogo: catA('PACKAGE_WIDTH'), numeric: true },
                                                            { label: 'Alto', propio: articleData?.alto_cm != null ? `${Math.round(articleData.alto_cm)} cm` : null, catalogo: catA('PACKAGE_HEIGHT'), numeric: true },
                                                        ].filter(x => x.propio != null || x.catalogo != null);
                                                        const coreIds = new Set(['BRAND', 'MODEL', 'GTIN', 'EAN', 'PACKAGE_WEIGHT', 'PACKAGE_LENGTH', 'PACKAGE_WIDTH', 'PACKAGE_HEIGHT']);
                                                        const extraAttrs = (r.atributos || []).filter((a: any) => !coreIds.has(a.id));
                                                        return (
                                                            <div key={r.catalog_product_id} className="p-2 bg-[var(--surface)] rounded border border-[var(--border)] space-y-2">
                                                                {/* Imágenes lado a lado */}
                                                                <div className="grid grid-cols-2 gap-2">
                                                                    <div>
                                                                        <p className="text-[9px] uppercase font-bold text-[var(--text-faint)] mb-1">Tu producto</p>
                                                                        <div className="flex flex-wrap gap-1">
                                                                            {(images.length ? images : preloadedSuggestions).slice(0, 3).map((url, i) => (
                                                                                <img key={i} src={url} alt="" className="w-12 h-12 object-cover rounded border border-[var(--border)]" />
                                                                            ))}
                                                                            {images.length === 0 && preloadedSuggestions.length === 0 && (
                                                                                <span className="text-[9px] text-[var(--text-faint)]">Sin imagen</span>
                                                                            )}
                                                                        </div>
                                                                        <p className="text-[11px] font-semibold text-[var(--text)] line-clamp-2 mt-1">{articleData?.nombre || nombreArticulo}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[9px] uppercase font-bold text-[var(--text-faint)] mb-1">Catálogo MeLi</p>
                                                                        <div className="flex flex-wrap gap-1">
                                                                            {(r.pictures?.length ? r.pictures : (r.thumbnail ? [r.thumbnail] : [])).slice(0, 3).map((pic: string, pi: number) => (
                                                                                <img key={pi} src={pic} alt="" className="w-12 h-12 object-cover rounded border border-[var(--border)]" />
                                                                            ))}
                                                                        </div>
                                                                        <p className="text-[11px] font-semibold text-[var(--text)] line-clamp-2 mt-1">{r.titulo}</p>
                                                                    </div>
                                                                </div>

                                                                {/* Comparación campo por campo */}
                                                                <div className="border-t border-[var(--border)] pt-1.5">
                                                                    <div className="flex items-center gap-2 mb-1">
                                                                        <span className="flex items-center gap-0.5 text-[8px] text-[var(--ok)]"><CheckCircle2 className="w-2.5 h-2.5" /> coincide</span>
                                                                        <span className="flex items-center gap-0.5 text-[8px] text-[var(--warn)]"><AlertCircle className="w-2.5 h-2.5" /> difiere</span>
                                                                    </div>
                                                                    <div className="grid grid-cols-[70px_1fr_1fr] gap-1.5 text-[9px] font-bold uppercase text-[var(--text-faint)] mb-1">
                                                                        <span>Campo</span><span>Tu producto</span><span>Catálogo</span>
                                                                    </div>
                                                                    <div className="space-y-0.5">
                                                                        {rows.map(row => {
                                                                            const both = row.propio != null && row.propio !== '' && row.catalogo != null && row.catalogo !== '';
                                                                            const match = both && (row.numeric ? toNum(row.propio) === toNum(row.catalogo) : norm(row.propio) === norm(row.catalogo));
                                                                            const tone = match ? 'text-[var(--ok)]' : both ? 'text-[var(--warn)]' : 'text-[var(--text-muted)]';
                                                                            return (
                                                                                <div key={row.label} className="grid grid-cols-[70px_1fr_1fr] gap-1.5 text-[9px] items-start">
                                                                                    <span className="text-[var(--text-faint)]">{row.label}</span>
                                                                                    <span className={cn(tone, both && 'font-semibold', 'break-words')}>{row.propio || '—'}</span>
                                                                                    <span className={cn(tone, both && 'font-semibold', 'break-words')}>{row.catalogo || '—'}</span>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>

                                                                {/* Otros atributos del catálogo */}
                                                                {extraAttrs.length > 0 && (
                                                                    <details className="border-t border-[var(--border)] pt-1">
                                                                        <summary className="text-[9px] font-bold text-[var(--text-faint)] cursor-pointer select-none">Otros atributos del catálogo ({extraAttrs.length})</summary>
                                                                        <div className="mt-1 space-y-0.5 max-h-28 overflow-y-auto">
                                                                            {extraAttrs.map((a: any) => (
                                                                                <div key={a.id} className="flex justify-between gap-1 text-[9px]">
                                                                                    <span className="text-[var(--text-faint)] shrink-0">{a.name}</span>
                                                                                    <span className="text-[var(--text-muted)] text-right">{a.value_name || '—'}</span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </details>
                                                                )}

                                                                {/* Acciones */}
                                                                <div className="flex items-center justify-end gap-2 pt-1 border-t border-[var(--border)]">
                                                                    <button type="button" onClick={() => omitirCatalog()} className="px-2 py-1 text-[10px] font-bold text-[var(--text-muted)] hover:text-[var(--text)]">No coincide</button>
                                                                    <button type="button" onClick={() => usarCatalog(r)} className="px-3 py-1 text-[10px] font-bold text-[var(--accent-ink)] bg-[var(--accent)] rounded hover:brightness-110">Coincide — usar catálogo</button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>

                                        {/* Categoría */}
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-[var(--text-faint)] tracking-wider block mb-1.5"><Tag className="w-3 h-3 inline mr-1" />Categoría MeLi</label>
                                            {/* Ruta activa (auto-predicha o seleccionada) */}
                                            <div className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--bg)]">
                                                <span className="font-mono text-[10px] text-[var(--text-faint)] mr-2">{curCatId}</span>
                                                <span className="text-[var(--text-muted)]">{activePath}</span>
                                            </div>
                                            {/* Select multi-opción solo si hay varias del dry-run */}
                                            {allCatOptions.length > 1 && (
                                                <select
                                                    value={curCatId}
                                                    onChange={e => { setCategoryOverride(e.target.value); setCatSelectedPath(''); }}
                                                    className="mt-1 w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400 bg-[var(--surface)] font-mono"
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
                                                <div className="flex items-center gap-1 px-3 py-2 border border-slate-300 rounded-lg bg-[var(--surface)] focus-within:ring-2 focus-within:ring-yellow-400">
                                                    <Search className="w-3.5 h-3.5 text-[var(--text-faint)] shrink-0" />
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
                                                                    const r = await fetch(`/api/publish/category-search?q=${encodeURIComponent(val.trim())}&marketplace_id=${encodeURIComponent(primaryAccount || '')}`);
                                                                    const d = await r.json();
                                                                    setCatSearchResults(d.ok ? d.candidates : []);
                                                                } catch { setCatSearchResults([]); }
                                                                finally { setCatSearchLoading(false); }
                                                            }, 400);
                                                        }}
                                                        placeholder="Buscar categoría en MeLi (ej. dado métrico)"
                                                        className="flex-1 text-sm bg-transparent outline-none placeholder-slate-400"
                                                    />
                                                    {catSearchLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-faint)] shrink-0" />}
                                                </div>
                                                {catSearchResults.length > 0 && (
                                                    <div className="absolute z-50 left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg max-h-48 overflow-y-auto">
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
                                                                className="w-full text-left px-3 py-2 text-xs hover:bg-yellow-50 border-b border-[var(--border)] last:border-0"
                                                            >
                                                                <span className="font-mono font-bold text-[var(--text-muted)] text-[10px]">{c.category_id}</span>
                                                                <span className="text-[var(--text-muted)] ml-2">{c.path || c.category_name || ''}</span>
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
                                        {/* Completar con IA */}
                                        <button
                                            type="button"
                                            onClick={completeWithAI}
                                            disabled={loading}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[var(--accent)] bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded-[var(--radius-sm)] hover:bg-[var(--accent)]/20 transition-colors disabled:opacity-50"
                                        >
                                            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />} Completar título y descripción con IA
                                        </button>
                                        {/* Título (legacy: title completo; UP: family_name) */}
                                        {(() => {
                                            const titleVal = familyNameOverride !== '' ? familyNameOverride : (t?.paso_8_ai?.family_name || t?.paso_9_titulo?.title_legacy || '');
                                            const over = titleVal.length > 60;
                                            return (
                                                <div>
                                                    <div className="flex items-center justify-between mb-1.5">
                                                        <label className="text-[10px] font-bold uppercase text-[var(--text-faint)] tracking-wider">Título (máx 60)</label>
                                                        <span className={cn("text-[10px] font-bold tabular-nums", over ? "text-[var(--err)]" : "text-[var(--text-faint)]")}>{titleVal.length}/60</span>
                                                    </div>
                                                    <input
                                                        type="text"
                                                        value={titleVal}
                                                        onChange={e => setFamilyNameOverride(e.target.value)}
                                                        maxLength={60}
                                                        className={cn("w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 font-mono",
                                                            over ? "border-[var(--err)] focus:ring-[var(--err)] text-[var(--err)]" : "border-[var(--border)] focus:ring-yellow-400")}
                                                    />
                                                    {over && <p className="text-[10px] text-[var(--err)] mt-1">El título supera 60 caracteres. Recórtalo.</p>}
                                                </div>
                                            );
                                        })()}
                                        {/* Precio */}
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-[var(--text-faint)] tracking-wider block mb-1.5">Precio de venta (MXN)</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value={priceOverride !== '' ? priceOverride : (t?.paso_9_titulo?.price_final ?? t?.paso_3_precio?.sale_price ?? '')}
                                                onChange={e => setPriceOverride(e.target.value)}
                                                placeholder="Sin precio — escribe uno manual"
                                                className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400 font-mono"
                                            />
                                            {(t?.paso_9_titulo?.price_final ?? t?.paso_3_precio?.sale_price ?? 0) <= 0 && (
                                                <p className="text-[10px] text-[var(--warn)] mt-1">Sin precio configurado: escribe el precio manual para poder publicar.</p>
                                            )}
                                        </div>
                                        {/* Stock */}
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-[var(--text-faint)] tracking-wider block mb-1.5">Stock a publicar</label>
                                            <input
                                                type="number"
                                                min="0"
                                                value={stockOverride !== '' ? stockOverride : (t?.paso_4_stock?.available_quantity ?? '')}
                                                onChange={e => setStockOverride(e.target.value)}
                                                placeholder="Stock (vacío = toma el del catálogo maestro)"
                                                className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400 font-mono"
                                            />
                                            <p className="text-[10px] text-[var(--text-faint)] mt-1">Vacío = usa el stock del catálogo maestro ({t?.paso_4_stock?.available_quantity ?? '—'}).</p>
                                        </div>
                                        {/* Descripción */}
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-[var(--text-faint)] tracking-wider block mb-1.5">Descripción</label>
                                            <textarea
                                                value={descriptionOverride}
                                                onChange={e => setDescriptionOverride(e.target.value)}
                                                rows={6}
                                                placeholder="Descripción del producto (vacío = se usa la del artículo/ficha técnica)"
                                                className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400 bg-[var(--surface)]"
                                            />
                                        </div>
                                        {/* Envío */}
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-[var(--text-faint)] tracking-wider block mb-1.5">Envío</label>
                                            <div className="space-y-2">
                                                <label className="flex items-center gap-2 text-xs text-[var(--text)] cursor-pointer">
                                                    <input type="checkbox" checked={freeShipping} onChange={e => setFreeShipping(e.target.checked)} className="w-4 h-4 rounded text-[var(--accent)] focus:ring-[var(--accent)]" />
                                                    Incluir envío gratis
                                                </label>
                                                <select value={shippingMode} onChange={e => setShippingMode(e.target.value)} className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-yellow-400">
                                                    <option value="me2">Mercado Envíos (ME2)</option>
                                                    <option value="custom">Envíos Personalizados (custom)</option>
                                                </select>
                                                {(() => {
                                                    const p = Number(priceOverride || (t?.paso_9_titulo?.price_final ?? t?.paso_3_precio?.sale_price ?? 0));
                                                    return p >= 299
                                                        ? <p className="text-[10px] text-[var(--info)]">Precio ≥ $299: MercadoLibre aplica envío gratis automáticamente en categorías elegibles.</p>
                                                        : <p className="text-[10px] text-[var(--text-faint)]">Precio &lt; $299: tú decides si incluir o no el envío gratis.</p>;
                                                })()}
                                            </div>
                                        </div>
                                        {/* Tiempo de elaboración */}
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-[var(--text-faint)] tracking-wider block mb-1.5">Días de elaboración</label>
                                            <input
                                                type="number"
                                                min="0"
                                                max="60"
                                                value={manufacturingDays}
                                                onChange={e => setManufacturingDays(e.target.value)}
                                                placeholder="0 = inmediato (no se envía el dato)"
                                                className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400 font-mono"
                                            />
                                            <p className="text-[10px] text-[var(--text-faint)] mt-1">0 o vacío = envío inmediato (MeLi omite el tiempo). 1–60 = días de preparación.</p>
                                        </div>
                                        {/* Dimensiones del paquete */}
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-[var(--text-faint)] tracking-wider block mb-1.5"><Package className="w-3 h-3 inline mr-1" />Dimensiones del paquete</label>
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
                                                            <label className="text-[9px] uppercase text-[var(--text-faint)] font-bold">{label}</label>
                                                            <div className="flex items-center border border-[var(--border)] rounded-lg bg-[var(--surface)] overflow-hidden focus-within:ring-2 focus-within:ring-yellow-400">
                                                                <input
                                                                    type="text"
                                                                    value={currentVal}
                                                                    onChange={e => setDimOverrides(prev => ({ ...prev, [id]: e.target.value }))}
                                                                    placeholder={`ej. 10 ${unit}`}
                                                                    className="flex-1 px-2 py-1.5 text-xs font-mono bg-transparent outline-none"
                                                                />
                                                                <span className="text-[9px] text-[var(--text-faint)] px-2 border-l border-[var(--border)]">{unit}</span>
                                                            </div>
                                                            {isEdited && <span className="text-[8px] text-blue-500 absolute right-0 top-0">editado</span>}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <p className="text-[9px] text-[var(--text-faint)] mt-1">Valores actuales del artículo. Edítalos si MeLi los rechazó. Formato: número espacio unidad (ej. &quot;10 cm&quot;, &quot;500 g&quot;)</p>
                                        </div>
                                        {/* Atributos requeridos */}
                                        {loadingAttrs ? (
                                            <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-700">
                                                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                                Cargando atributos de la nueva categoría...
                                            </div>
                                        ) : reqAttrs.length > 0 && (
                                            <div>
                                                <label className="text-[10px] font-bold uppercase text-[var(--text-faint)] tracking-wider block mb-2">Atributos requeridos ({reqAttrs.length})</label>
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
                                                            <div key={attr.id} className={cn('p-2.5 rounded-lg border', isMissing ? 'border-[var(--err)]/30 bg-[var(--err)]/10' : 'border-[var(--border)] bg-[var(--bg)]')}>
                                                                <div className="flex items-center justify-between mb-1.5">
                                                                    <span className="text-xs font-bold text-[var(--text-muted)]">{attr.name}</span>
                                                                    <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase', ov ? 'bg-blue-100 text-blue-700' : isMissing ? 'bg-rose-100 text-[var(--err)]' : 'bg-emerald-100 text-[var(--ok)]')}>{ov ? 'Editado' : isMissing ? 'Faltante' : 'Auto'}</span>
                                                                </div>
                                                                {attr.values?.length > 0 ? (
                                                                    <select value={valId} onChange={e => { const opt = attr.values.find((v: any) => v.id === e.target.value); setAttrOverrides(prev => ({ ...prev, [attr.id]: { value_id: e.target.value, value_name: opt?.name } })); }} className="w-full px-2 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:outline-none focus:ring-1 focus:ring-yellow-400">
                                                                        <option value="">— Seleccionar —</option>
                                                                        {attr.values.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
                                                                    </select>
                                                                ) : (
                                                                    <input type="text" value={valName} onChange={e => setAttrOverrides(prev => ({ ...prev, [attr.id]: { value_name: e.target.value } }))} placeholder={`Ingresa ${attr.name}`} className="w-full px-2 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:outline-none focus:ring-1 focus:ring-yellow-400 font-mono" />
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                        {/* Características secundarias (opcionales) */}
                                        {(() => {
                                            const optAttrs: any[] = dynamicOptAttrs ?? (t?.paso_6_atributos?.optional_detail || []);
                                            if (optAttrs.length === 0) return null;
                                            return (
                                                <details open className="mt-2">
                                                    <summary className="text-[10px] font-bold uppercase text-[var(--text-faint)] tracking-wider cursor-pointer select-none">Características secundarias (opcionales) — {optAttrs.length}</summary>
                                                    <div className="mt-2 space-y-2 max-h-80 overflow-y-auto pr-1">
                                                        {optAttrs.map((attr: any) => {
                                                            const ov = attrOverrides[attr.id];
                                                            const curVal = originalAttrs.find((a: any) => a.id === attr.id) ?? null;
                                                            const valId = ov?.value_id ?? curVal?.value_id ?? '';
                                                            const valName = ov?.value_name ?? curVal?.value_name ?? '';
                                                            return (
                                                                <div key={attr.id} className="p-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                                                                    <div className="flex items-center justify-between mb-1">
                                                                        <span className="text-xs font-semibold text-[var(--text-muted)]">{attr.name}</span>
                                                                        <span className="text-[9px] font-mono text-[var(--text-faint)]">{attr.id}</span>
                                                                    </div>
                                                                    {attr.values?.length > 0 ? (
                                                                        <select value={valId} onChange={e => { const opt = attr.values.find((v: any) => v.id === e.target.value); setAttrOverrides(prev => ({ ...prev, [attr.id]: { value_id: e.target.value, value_name: opt?.name } })); }} className="w-full px-2 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:outline-none focus:ring-1 focus:ring-yellow-400">
                                                                            <option value="">— (sin especificar) —</option>
                                                                            {attr.values.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
                                                                        </select>
                                                                    ) : (
                                                                        <input type="text" value={valName} onChange={e => setAttrOverrides(prev => ({ ...prev, [attr.id]: { value_name: e.target.value } }))} placeholder={`Ingresa ${attr.name}`} className="w-full px-2 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:outline-none focus:ring-1 focus:ring-yellow-400 font-mono" />
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </details>
                                            );
                                        })()}

                                        {/* Stepper transparente + trace técnico colapsado */}
                                        <PublishStepper trace={t || {}} />
                                        <TraceBlock trace={t || {}} />

                                        {/* Publicar similar (duplicado independiente) */}
                                        <label className="flex items-start gap-2 text-xs text-[var(--text)] cursor-pointer p-2 rounded border border-[var(--border)] bg-[var(--surface-2)]">
                                            <input type="checkbox" checked={forceDuplicate} onChange={e => setForceDuplicate(e.target.checked)} className="w-4 h-4 rounded text-[var(--accent)] focus:ring-[var(--accent)] mt-0.5" />
                                            <span>Publicar <strong>duplicado independiente</strong> (idéntico, sin enlazar). Para una <strong>nueva condición de venta</strong> (Clásica ↔ Premium, enlazada), usa el botón <strong>&quot;Condición&quot;</strong> en la sección &quot;Publicaciones / Vitrinas enlazadas&quot;.</span>
                                        </label>

                                        {/* CTAs */}
                                        <div className="flex gap-3">
                                            <button id="publish-back-btn" onClick={resetPanel} className="flex-1 py-2.5 border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg)] font-bold rounded-xl text-sm transition-colors">Volver</button>
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
                                    className="w-full py-2.5 border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg)] font-bold rounded-xl text-sm transition-colors"
                                >
                                    <RefreshCw className="w-4 h-4 inline mr-1" />
                                    Volver a configurar
                                </button>
                            )}

                            {/* Si el trace existe pero el status no es 200/409/422/404 */}
                            {previewResult.status >= 500 && (
                                <div className="p-3 bg-[var(--err)]/10 border border-[var(--err)]/30 rounded-lg space-y-2">
                                    <p className="text-xs text-[var(--err)] font-bold">Error del servidor: {previewResult.data.error}</p>

                                    {previewResult.data.trace && <TraceBlock trace={previewResult.data.trace} />}
                                    <button onClick={resetPanel} className="mt-2 text-xs text-[var(--err)] underline">Volver</button>
                                </div>
                            )}
                        </>
                    )}

                    {/* -- ETAPA 3: RESULTADO FINAL --------------------------- */}
                    {stage === 'result' && publishResult && (
                        <div className="space-y-3">
                            {/* Resultado multi-cuenta */}
                            {publishResult.status === 'multi' && (
                                <div className="space-y-2">
                                    <div className="p-3 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
                                        <p className="text-sm font-bold text-[var(--text)]">Publicación en {publishResult.data.results.length} cuenta(s)</p>
                                    </div>
                                    {publishResult.data.results.map((r: any, i: number) => (
                                        <div key={i} className={cn("p-3 rounded-lg border", r.ok ? "bg-[var(--ok)]/10 border-[var(--ok)]/30" : "bg-[var(--err)]/10 border-[var(--err)]/30")}>
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="text-sm font-semibold text-[var(--text)]">{r.account_name}</p>
                                                {r.ok ? <CheckCircle2 className="w-4 h-4 text-[var(--ok)]" /> : <XCircle className="w-4 h-4 text-[var(--err)]" />}
                                            </div>
                                            {r.ok ? (
                                                <p className="text-xs font-mono text-[var(--ok)] mt-1">{r.item_id}</p>
                                            ) : (
                                                <div className="mt-1 space-y-1">
                                                    <p className="text-xs text-[var(--err)]">{r.error}</p>
                                                    {r.meli_message && <p className="text-xs text-[var(--err)]">{r.meli_message}</p>}
                                                    {r.errores?.length > 0 && <p className="text-xs text-[var(--err)] font-mono break-all">{r.errores.join(' | ')}</p>}
                                                    {r.meli_error?.cause?.length > 0 && (
                                                        <div className="space-y-0.5">
                                                            {r.meli_error.cause.map((c: any, ci: number) => (
                                                                <p key={ci} className="text-[10px] text-[var(--err)] font-mono bg-[var(--surface)] px-2 py-1 rounded">[{c.code}] {c.message}</p>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {r.meli_error && !(r.meli_error?.cause?.length > 0) && !(r.errores?.length > 0) && (
                                                        <details className="text-[10px] font-mono text-[var(--err)]">
                                                            <summary className="cursor-pointer font-bold">Ver respuesta cruda de MeLi</summary>
                                                            <pre className="whitespace-pre-wrap break-all bg-[var(--surface)] p-2 rounded mt-1">{JSON.stringify(r.meli_error, null, 2)}</pre>
                                                        </details>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Éxito */}
                            {publishResult.status === 200 && publishResult.data.ok && (
                                <div className="p-5 bg-[var(--ok)]/10 border border-[var(--ok)]/30 rounded-xl text-center">
                                    <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                                    <h3 className="font-bold text-emerald-800 text-base mb-1">¡Publicación exitosa!</h3>
                                    <p className="text-sm font-mono font-bold text-[var(--ok)] mb-3">
                                        {publishResult.data.item_id}
                                    </p>
                                    <p className="text-xs text-[var(--ok)] mb-3">
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

                            {/* Error genérico (solo para resultado único, no multi) */}
                            {publishResult.status !== 'multi' && !publishResult.data.ok && publishResult.status !== 409 && (
                                <div className="p-4 bg-[var(--err)]/10 border border-[var(--err)]/30 rounded-xl">
                                    <div className="flex items-center gap-2 mb-1">
                                        <XCircle className="w-4 h-4 text-[var(--err)]" />
                                        <h3 className="font-bold text-rose-800 text-sm">Error al publicar</h3>
                                    </div>
                                    <p className="text-xs text-[var(--err)]">{publishResult.data.error}</p>
                                    {publishResult.data.errores?.map((e: string, i: number) => (
                                        <p key={i} className="text-xs text-[var(--err)] font-mono bg-rose-100 px-2 py-1 rounded mt-1">• {e}</p>
                                    ))}
                                    {publishResult.data.meli_error && (
                                        <div className="mt-3 p-3 bg-rose-100 rounded-lg border border-rose-300">
                                            <p className="text-[10px] font-bold uppercase text-[var(--err)] mb-1.5">Detalle de rechazo MeLi</p>
                                            {publishResult.data.meli_error.message && (
                                                <p className="text-xs font-bold text-rose-800 mb-1">{publishResult.data.meli_error.message}</p>
                                            )}
                                            {publishResult.data.meli_error.cause?.map((c: any, i: number) => (
                                                <p key={i} className="text-xs text-[var(--err)] font-mono bg-[var(--surface)] px-2 py-1 rounded mt-1">[{c.code}] {c.message}</p>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Trace colapsado */}
                            {publishResult.data.trace && <TraceBlock trace={publishResult.data.trace} />}

                            {/* Botones de acción post-resultado */}
                            {(publishResult.status === 'multi'
                                ? publishResult.data.results.some((r: any) => !r.ok)
                                : (!publishResult.data.ok && publishResult.status !== 409)) ? (
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setStage('preview')}
                                        className="flex-1 py-2.5 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-bold rounded-xl text-sm transition-colors shadow-sm"
                                    >
                                        <RefreshCw className="w-4 h-4 inline mr-1" />
                                        Volver a editar (sin perder datos)
                                    </button>
                                    <button
                                        onClick={resetPanel}
                                        className="flex-1 py-2.5 border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg)] font-bold rounded-xl text-sm transition-colors"
                                    >
                                        Nueva publicación
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={resetPanel}
                                    className="w-full py-2.5 border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg)] font-bold rounded-xl text-sm transition-colors"
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
