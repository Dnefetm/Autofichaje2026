"use client";

import { useState, useCallback, useRef, useEffect } from 'react';
import {
    Upload, Sparkles, CheckCircle2, Save, Trash2, Camera,
    Loader2, AlertCircle, Search, X, FileText, Image as ImageIcon,
    Link2, Plus, ChevronDown, Clock, Smartphone,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { AutofichaResult } from '@gestor/sync/autoficha';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cn(...classes: (string | boolean | undefined | null)[]) {
    return classes.filter(Boolean).join(' ');
}

function ConfidenceBadge({ value }: { value: number }) {
    if (value >= 0.8) return <span className="text-[10px] font-bold text-emerald-600">● {Math.round(value * 100)}%</span>;
    if (value >= 0.5) return <span className="text-[10px] font-bold text-amber-500">● {Math.round(value * 100)}%</span>;
    return <span className="text-[10px] font-bold text-rose-500">● {Math.round(value * 100)}%</span>;
}

function ScoreBadge({ score, label }: { score: number; label: string }) {
    const color = score >= 80 ? 'bg-emerald-100 text-emerald-700' :
                  score >= 60 ? 'bg-amber-100 text-amber-700' :
                                'bg-slate-100 text-slate-500';
    return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${color}`}>{label} ({score})</span>;
}

// ─── Campo controlado ─────────────────────────────────────────────────────────

interface FieldProps {
    label: string; value: string | number | undefined;
    onChange: (v: string) => void; type?: 'text' | 'number' | 'textarea'; mono?: boolean;
}
function Field({ label, value, onChange, type = 'text', mono = false }: FieldProps) {
    const cls = cn('w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:ring-1 focus:ring-indigo-500 outline-none', mono && 'font-mono');
    return (
        <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</label>
            {type === 'textarea'
                ? <textarea className={cn(cls, 'h-24 resize-none')} value={value ?? ''} onChange={e => onChange(e.target.value)} />
                : <input type={type} className={cls} value={value ?? ''} onChange={e => onChange(e.target.value)} />
            }
        </div>
    );
}

// ─── Card enriquecida de artículo (BLOQUE 1) ─────────────────────────────────

interface ArticuloMatch {
    articulo_id: string; nombre: string; marca: string;
    modelo?: string; variante?: string; categoria?: string;
    descripcion?: string; codigo_universal?: string; codigo_sat?: string;
    score: number; score_label: string;
}
type SaveMode = 'create' | 'update' | 'link_only';

function ArticuloCard({ match, onSelect }: { match: ArticuloMatch; onSelect: (m: ArticuloMatch, mode: SaveMode) => void }) {
    return (
        <div className="p-4 bg-white border border-slate-200 rounded-xl hover:border-indigo-300 transition-colors space-y-2">
            <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-sm text-slate-800 leading-tight">{match.nombre}</p>
                <ScoreBadge score={match.score} label={match.score_label} />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                <span><b>SKU:</b> <code className="text-slate-700">{match.articulo_id}</code></span>
                <span><b>Marca:</b> {match.marca}</span>
                {match.modelo            && <span><b>Modelo:</b> {match.modelo}</span>}
                {match.variante          && <span><b>Variante:</b> {match.variante}</span>}
                {match.codigo_universal  && <span><b>EAN:</b> <code>{match.codigo_universal}</code></span>}
                {match.codigo_sat        && <span><b>SAT:</b> <code>{match.codigo_sat}</code></span>}
                {match.categoria         && <span><b>Cat:</b> {match.categoria}</span>}
            </div>
            {match.descripcion && <p className="text-xs text-slate-400 line-clamp-2">{match.descripcion}</p>}
            <div className="flex gap-2 pt-1">
                <button onClick={() => onSelect(match, 'update')}
                    className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold">
                    Actualizar campos vacíos
                </button>
                <button onClick={() => onSelect(match, 'link_only')}
                    className="text-xs px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 font-semibold">
                    Solo vincular
                </button>
            </div>
        </div>
    );
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

type InputMode = 'file' | 'url';
type Status    = 'idle' | 'uploading' | 'processing' | 'done' | 'saving' | 'saved' | 'error';

interface FileEntry {
    file: File; progress: number;
    storagePath?: string; storageUrl?: string; error?: string;
}

interface Borrador {
    id: string; estado: string; input_mode: string;
    url_origen?: string; archivos_storage: any[];
    resultado_ia?: any; editado?: any; confianza?: number;
    articulo_vinculado?: string; modo_guardado?: string;
    dispositivo?: string; updated_at: string;
}

const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const MAX_MB = 50;
const OPERADOR_ID = 'operador_1';

// ─── Página principal ─────────────────────────────────────────────────────────

export default function AutofichaPage() {
    // Entrada
    const [inputMode, setInputMode]   = useState<InputMode>('file');
    const [files, setFiles]           = useState<FileEntry[]>([]);
    const [url, setUrl]               = useState('');
    // Estado general
    const [status, setStatus]         = useState<Status>('idle');
    const [errorMsg, setErrorMsg]     = useState('');
    // Resultado IA
    const [result, setResult]         = useState<AutofichaResult | null>(null);
    const [edited, setEdited]         = useState<AutofichaResult | null>(null);
    // Vinculación al catálogo
    const [suggestions, setSuggestions]     = useState<ArticuloMatch[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [searchQ, setSearchQ]             = useState('');
    const [searchResults, setSearchResults] = useState<ArticuloMatch[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [linkedArticulo, setLinkedArticulo] = useState<ArticuloMatch | null>(null);
    const [saveMode, setSaveMode]           = useState<SaveMode>('create');
    // Borradores (BLOQUE 3)
    const [borradores, setBorradores]       = useState<Borrador[]>([]);
    const [currentBorrador, setCurrentBorrador] = useState<string | null>(null);
    const [showBorradores, setShowBorradores]   = useState(false);
    const autoSaveRef                           = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Atributos dinámicos 3 capas (v4)
    const [plantillaCampos, setPlantillaCampos]   = useState<any[]>([]);
    const [atribCategoria, setAtribCategoria]     = useState<Record<string, any>>({});
    const [atribExtras, setAtribExtras]           = useState<Record<string, any>>({});
    // UI
    const [dragOver, setDragOver]       = useState(false);
    const [isMobile, setIsMobile]       = useState(false);
    const inputRef                      = useRef<HTMLInputElement>(null);
    const cameraRef                     = useRef<HTMLInputElement>(null);

    // Detectar dispositivo (BLOQUE 4)
    useEffect(() => {
        setIsMobile(/iPhone|iPad|Android/i.test(navigator.userAgent));
        loadBorradores();
    }, []);

    // ── Borradores ────────────────────────────────────────────────────────────

    async function loadBorradores() {
        try {
            const res = await fetch(`/api/autoficha/borradores?operador=${OPERADOR_ID}`);
            if (res.ok) { const d = await res.json(); setBorradores(d.borradores ?? []); }
        } catch { /* silencioso */ }
    }

    async function saveBorrador(updates: Record<string, any> = {}) {
        const payload = {
            operador_id: OPERADOR_ID,
            input_mode:  inputMode,
            url_origen:  url || null,
            archivos_storage: files.filter(f => f.storageUrl).map(f => ({
                path: f.storagePath, url: f.storageUrl, nombre: f.file.name,
                tipo: f.file.type, tamano: f.file.size,
            })),
            dispositivo: isMobile ? 'mobile' : 'desktop',
            ...updates,
        };
        if (currentBorrador) {
            await fetch('/api/autoficha/borradores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: currentBorrador, ...payload }) });
        } else {
            const res = await fetch('/api/autoficha/borradores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (res.ok) { const d = await res.json(); setCurrentBorrador(d.borrador?.id); }
        }
        loadBorradores();
    }

    function scheduleAutoSave() {
        if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
        autoSaveRef.current = setTimeout(() => saveBorrador(), 5000);
    }

    async function guardarBorrador() {
        await saveBorrador({ estado: 'pendiente' });
    }

    async function continuarBorrador(b: Borrador) {
        setCurrentBorrador(b.id);
        setInputMode((b.input_mode as InputMode) || 'file');
        setUrl(b.url_origen || '');
        if (b.archivos_storage?.length > 0) {
            // Mostrar archivos ya subidos como entradas con 100% progreso
            const entries: FileEntry[] = b.archivos_storage.map((a: any) => ({
                file: new File([], a.nombre, { type: a.tipo }),
                progress: 100, storagePath: a.path, storageUrl: a.url,
            }));
            setFiles(entries);
        }
        if (b.editado) {
            setResult(b.editado as AutofichaResult);
            setEdited(b.editado as AutofichaResult);
            setStatus('done');
        }
        setShowBorradores(false);
    }

    async function eliminarBorrador(id: string, e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[eliminarBorrador] called, id:', id);  // diagnóstico temporal
        try {
            const res = await fetch(`/api/autoficha/borradores/${id}`, { method: 'DELETE' });
            console.log('[eliminarBorrador] response status:', res.status);
            if (res.ok) {
                // Actualizar estado SOLO después de confirmar éxito en el servidor
                setBorradores(prev => prev.filter(b => b.id !== id));
                if (currentBorrador === id) setCurrentBorrador(null);
            } else {
                const d = await res.json().catch(() => ({}));
                console.error('[eliminarBorrador] error del servidor:', d?.error || res.status);
                loadBorradores(); // Recargar para mostrar estado real
            }
        } catch (err) {
            console.error('[eliminarBorrador] error de red:', err);
            loadBorradores();
        }
    }

    // ── Edición de campos ─────────────────────────────────────────────────────

    function updateField<K extends keyof AutofichaResult>(key: K, value: AutofichaResult[K]) {
        setEdited(prev => prev ? { ...prev, [key]: value } : prev);
        scheduleAutoSave();
    }

    // ── Archivos ──────────────────────────────────────────────────────────────

    function addFiles(newFiles: FileList | File[]) {
        const entries: FileEntry[] = [];
        for (const f of Array.from(newFiles)) {
            if (!ALLOWED_MIME.includes(f.type)) entries.push({ file: f, progress: 0, error: `Formato no soportado: ${f.type}` });
            else if (f.size > MAX_MB * 1e6)     entries.push({ file: f, progress: 0, error: `Demasiado grande (${(f.size / 1e6).toFixed(1)} MB). Máx ${MAX_MB} MB` });
            else                                 entries.push({ file: f, progress: 0 });
        }
        setFiles(prev => [...prev, ...entries].slice(0, 10));
        scheduleAutoSave();
    }

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault(); setDragOver(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    }, []);

    // ── Storage upload ────────────────────────────────────────────────────────

    async function uploadFilesToStorage(entries: FileEntry[]): Promise<FileEntry[]> {
        const updated = [...entries];
        for (let i = 0; i < updated.length; i++) {
            const entry = updated[i];
            if (entry.error || entry.storageUrl) continue; // skip errores o ya subidos
            const path = `autofichas/${Date.now()}_${entry.file.name}`;
            setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, progress: 30 } : f));
            try {
                const { error } = await supabase.storage.from('documentos-fuente').upload(path, entry.file, { contentType: entry.file.type, upsert: false });
                if (error) throw error;
                const { data: urlData } = supabase.storage.from('documentos-fuente').getPublicUrl(path);
                updated[i] = { ...entry, progress: 100, storagePath: path, storageUrl: urlData.publicUrl };
                setFiles(prev => prev.map((f, idx) => idx === i ? updated[i] : f));
            } catch (err: any) {
                updated[i] = { ...entry, progress: 0, error: err?.message || 'Error al subir' };
                setFiles(prev => prev.map((f, idx) => idx === i ? updated[i] : f));
            }
        }
        return updated;
    }

    // ── Procesar con IA ───────────────────────────────────────────────────────

    const handleProcess = useCallback(async () => {
        setStatus('uploading'); setErrorMsg('');
        setSuggestions([]); setSearchResults([]); setLinkedArticulo(null);
        setPlantillaCampos([]); setAtribCategoria({}); setAtribExtras({});

        try {
            let response: Response;
            if (inputMode === 'file') {
                const validFiles = files.filter(f => !f.error);
                if (validFiles.length === 0) { setStatus('idle'); return; }
                const uploaded = await uploadFilesToStorage(validFiles);
                const urls = uploaded.filter(f => f.storageUrl).map(f => f.storageUrl!);
                if (urls.length === 0) { setErrorMsg('No se pudo subir ningún archivo a Storage.'); setStatus('error'); return; }
                // Guardar borrador con el resultado del upload
                await saveBorrador({ estado: 'procesando', archivos_storage: uploaded.filter(f => f.storageUrl).map(f => ({ path: f.storagePath, url: f.storageUrl, nombre: f.file.name, tipo: f.file.type, tamano: f.file.size })) });
                setStatus('processing');
                response = await fetch('/api/autoficha', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(urls.length === 1 ? { url: urls[0] } : { urls }),
                });
            } else {
                if (!url.trim()) { setStatus('idle'); return; }
                setStatus('processing');
                response = await fetch('/api/autoficha', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: url.trim() }),
                });
            }

            const data = await response.json();
            if (!response.ok) { setErrorMsg(data.error || 'Error al procesar.'); setStatus('error'); return; }

            const af = data as AutofichaResult;
            setResult(af); setEdited(af); setStatus('done');
            // Cargar plantilla de la categoría y separar atributos en 2 cubetas (v4)
            try {
                const pRes = await fetch(`/api/autoficha/plantillas?categoria=${encodeURIComponent(af.categoria || '')}`);
                if (pRes.ok) { const pd = await pRes.json(); setPlantillaCampos(pd.campos || []); }
            } catch { /* no bloquear */ }
            setAtribCategoria((data as any).atributos_categoria || {});
            setAtribExtras((data as any).atributos_extras || {});
            await saveBorrador({ estado: 'listo', resultado_ia: af, editado: af, confianza: af.confidence });

            // Sugerencias automáticas (solo informativas)
            try {
                const params = new URLSearchParams();
                if (af.sku_detectado)    params.set('sku',    af.sku_detectado);
                if (af.codigo_universal) params.set('ean',    af.codigo_universal);
                if (af.modelo)           params.set('modelo', af.modelo);
                if (af.nombre)           params.set('nombre', af.nombre);
                const sr = await fetch(`/api/autoficha/search?${params}`);
                if (sr.ok) {
                    const { matches } = await sr.json();
                    if (matches?.length > 0) { setSuggestions(matches); setShowSuggestions(true); }
                }
            } catch { /* no bloquear */ }

        } catch (err: any) {
            setErrorMsg(err?.message || 'Error de red.'); setStatus('error');
        }
    }, [files, url, inputMode]);

    // ── Búsqueda manual ───────────────────────────────────────────────────────

    const handleManualSearch = async () => {
        if (!searchQ.trim() || searchQ.trim().length < 2) return;
        setSearchLoading(true);
        try {
            const res = await fetch(`/api/autoficha/search?q=${encodeURIComponent(searchQ.trim())}`);
            if (res.ok) { const { matches } = await res.json(); setSearchResults(matches ?? []); }
        } catch { /* silent */ }
        setSearchLoading(false);
    };

    function selectArticulo(match: ArticuloMatch, mode: SaveMode) {
        setLinkedArticulo(match); setSaveMode(mode);
        setSearchResults([]); setSearchQ('');
    }

    // ── Guardar en catálogo ───────────────────────────────────────────────────

    const handleSave = useCallback(async () => {
        if (!edited) return;
        setStatus('saving');
        // Prioridad: artículo vinculado > SKU manual ingresado > modelo detectado por IA
        // El sku_detectado puede ser un número de parte del proveedor, NO necesariamente el SKU de tienda
        const articulo_id = linkedArticulo?.articulo_id
            || (edited as any).sku_tienda   // campo manual que el usuario completó
            || edited.sku_detectado;         // último recurso: lo que detectó la IA
        const primaryFile = files.find(f => f.storageUrl);

        try {
            const { error } = await supabase.rpc('guardar_ficha_autoficha', {
                p: {
                    p_mode:           linkedArticulo ? saveMode : 'create',
                    articulo_id,
                    sku_detectado:    edited.sku_detectado,
                    // Identificación
                    nombre:           edited.nombre           || null,
                    marca:            edited.marca            || null,
                    fabricante:       edited.fabricante       || edited.marca || null,
                    modelo:           edited.modelo           || null,
                    variante:         edited.variante         || null,
                    categoria:        edited.categoria        || null,
                    // Descripciones
                    descripcion:      edited.descripcion      || null,
                    descripcion_larga: edited.descripcion_larga || null,
                    especificaciones: edited.especificaciones || null,
                    ingredientes:     edited.ingredientes     || null,
                    uso_recomendado:  edited.uso_recomendado  || null,
                    precauciones:     edited.precauciones     || null,
                    // Listas JSONB
                    bullet_points:    edited.bullet_points    || null,
                    palabras_clave:   edited.palabras_clave   || null,
                    // Códigos
                    codigo_universal: edited.codigo_universal || null,
                    codigo_sat:       edited.codigo_sat       || null,
                    // Dimensiones
                    peso_kg:          edited.peso_kg          || null,
                    largo_cm:         edited.largo_cm         || null,
                    ancho_cm:         edited.ancho_cm         || null,
                    alto_cm:          edited.alto_cm          || null,
                    materiales:       edited.materiales       || null,
                    pais_origen:      edited.pais_origen      || null,
                    // Atributos híbridos (v4)
                    atributos_categoria: atribCategoria,
                    atributos_extras:    atribExtras,
                    // Metadata del documento
                    nombre_archivo:   primaryFile?.file.name || url.split('/').pop() || 'documento',
                    url_storage:      result?.storage_path   || null,
                    url_origen:       inputMode === 'url' ? url : null,
                    tipo_archivo:     primaryFile?.file.type || 'application/pdf',
                    tamano_bytes:     primaryFile?.file.size ?? null,
                    texto_extraido:   result?.rawText?.slice(0, 50_000) || null,
                    ocr_confianza:    result?.confidence     || null,
                    confidence:       result?.confidence     || null,
                }
            });
            if (error) throw error;
            // Marcar borrador como guardado
            if (currentBorrador) {
                await fetch(`/api/autoficha/borradores/${currentBorrador}`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ estado: 'guardado', articulo_vinculado: articulo_id, modo_guardado: saveMode }),
                });
            }
            setStatus('saved');
            setTimeout(() => {
                setResult(null); setEdited(null); setFiles([]); setUrl('');
                setSuggestions([]); setLinkedArticulo(null);
                setCurrentBorrador(null); setStatus('idle');
                loadBorradores();
            }, 2000);
        } catch (err: any) {
            setErrorMsg(err?.message || 'Error al guardar.'); setStatus('error');
        }
    }, [edited, linkedArticulo, saveMode, files, url, inputMode, result, currentBorrador, atribCategoria, atribExtras]);

    // ── Reset ─────────────────────────────────────────────────────────────────

    function handleReset() {
        setResult(null); setEdited(null); setFiles([]); setUrl('');
        setErrorMsg(''); setSuggestions([]); setLinkedArticulo(null);
        setSearchQ(''); setSearchResults([]); setCurrentBorrador(null); setStatus('idle');
        setPlantillaCampos([]); setAtribCategoria({}); setAtribExtras({});
    }

    // ── Render ────────────────────────────────────────────────────────────────

    const isProcessing = status === 'uploading' || status === 'processing';
    const isSaving     = status === 'saving';
    const isSaved      = status === 'saved';
    const canProcess   = inputMode === 'file' ? files.filter(f => !f.error).length > 0 : url.trim().length > 0;
    const pendingBorradores = borradores.filter(b => b.estado !== 'guardado');

    return (
        <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-700">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Crear con IA — Autofichas</h2>
                <p className="text-slate-500 text-lg">Digitaliza fichas técnicas y catálogos de proveedores en segundos.</p>
            </div>

            {/* ── Banner de borradores (BLOQUE 3) ─────────────────────────── */}
            {pendingBorradores.length > 0 && !result && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                    <button onClick={() => setShowBorradores(p => !p)}
                        className="w-full flex items-center justify-between text-sm font-semibold text-amber-800">
                        <span className="flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            {pendingBorradores.length} borrador{pendingBorradores.length !== 1 ? 'es' : ''} pendiente{pendingBorradores.length !== 1 ? 's' : ''}
                            {pendingBorradores.some(b => b.dispositivo === 'mobile') && <span className="flex items-center gap-1 text-xs font-normal text-amber-600 ml-1"><Smartphone className="w-3 h-3" /> desde celular</span>}
                        </span>
                        <ChevronDown className={cn('w-4 h-4 transition-transform', showBorradores && 'rotate-180')} />
                    </button>
                    {showBorradores && (
                        <div className="mt-3 space-y-2">
                            {pendingBorradores.map(b => (
                                <div key={b.id} className="relative flex items-center gap-3 p-3 bg-white border border-amber-200 rounded-xl text-sm">
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-slate-700 truncate">
                                            {b.archivos_storage?.length > 0
                                                ? `${b.archivos_storage.length} archivo${b.archivos_storage.length !== 1 ? 's' : ''}: ${b.archivos_storage[0]?.nombre || '…'}`
                                                : b.url_origen ? `URL: ${b.url_origen.slice(0, 40)}…` : 'Borrador vacío'}
                                        </p>
                                        <p className="text-xs text-amber-600 mt-0.5">
                                            {b.dispositivo === 'mobile' && <Smartphone className="w-3 h-3 inline mr-1" />}
                                            {b.estado} · {new Date(b.updated_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => continuarBorrador(b)}
                                        className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700">
                                        Continuar
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="Eliminar borrador"
                                        onClick={(e) => eliminarBorrador(b.id, e)}
                                        className="relative z-10 p-1.5 shrink-0 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors">
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {!result ? (
                <>
                    {/* Selector de modo */}
                    <div className="flex gap-2">
                        {(['file', 'url'] as const).map(m => (
                            <button key={m} onClick={() => { setInputMode(m); setFiles([]); }}
                                className={cn('px-4 py-2 rounded-xl text-sm font-semibold border transition-colors',
                                    inputMode === m ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300')}>
                                {m === 'file' ? '📄 Subir archivos' : '🔗 URL de documento'}
                            </button>
                        ))}
                    </div>

                    {inputMode === 'file' ? (
                        <div className="space-y-4">
                            {/* BLOQUE 4: Botón Tomar Foto adicional (no reemplaza) */}
                            {isMobile && (
                                <div>
                                    <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
                                        onChange={e => e.target.files && addFiles(e.target.files)} />
                                    <button onClick={() => cameraRef.current?.click()}
                                        className="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 flex items-center justify-center gap-3 text-base transition-colors">
                                        <Camera className="w-6 h-6" /> Tomar foto del producto
                                    </button>
                                    <p className="text-xs text-slate-400 text-center mt-1">También puedes arrastrar archivos o seleccionarlos manualmente abajo ↓</p>
                                </div>
                            )}

                            {/* Drop zone */}
                            <div className={cn('relative bg-white border-2 border-dashed rounded-3xl p-12 flex flex-col items-center justify-center text-center gap-4 transition-all cursor-pointer',
                                dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-indigo-400')}
                                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                                onDragLeave={() => setDragOver(false)}
                                onDrop={onDrop} onClick={() => inputRef.current?.click()}>
                                <input ref={inputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" multiple className="hidden"
                                    onChange={e => e.target.files && addFiles(e.target.files)} />
                                <div className={cn('w-16 h-16 rounded-2xl flex items-center justify-center transition-colors', dragOver ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-50 text-slate-400')}>
                                    <Upload className="w-8 h-8" />
                                </div>
                                <div>
                                    <p className="font-bold text-lg text-slate-700">{dragOver ? 'Suelta los archivos' : 'Arrastra o haz clic para seleccionar'}</p>
                                    <p className="text-slate-400 text-sm mt-1">PDF, PNG, JPEG, WEBP · máx. 50 MB por archivo · hasta 10 archivos</p>
                                </div>
                            </div>

                            {/* Lista de archivos */}
                            {files.length > 0 && (
                                <div className="space-y-2">
                                    {files.map((entry, i) => (
                                        <div key={i} className={cn('flex items-center gap-3 p-3 rounded-xl border text-sm',
                                            entry.error ? 'bg-rose-50 border-rose-200' : entry.progress === 100 ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200')}>
                                            {entry.file.type.startsWith('image/') ? <ImageIcon className="w-4 h-4 text-slate-400 shrink-0" /> : <FileText className="w-4 h-4 text-slate-400 shrink-0" />}
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium truncate">{entry.file.name}</p>
                                                {entry.error ? <p className="text-rose-600 text-xs">{entry.error}</p>
                                                    : entry.progress === 100 ? <p className="text-emerald-600 text-xs">✓ Subido a Storage</p>
                                                    : entry.progress > 0 ? <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${entry.progress}%` }} /></div>
                                                    : <p className="text-slate-400 text-xs">{(entry.file.size / 1e6).toFixed(1)} MB</p>}
                                            </div>
                                            <button onClick={() => setFiles(p => p.filter((_, j) => j !== i))} className="text-slate-300 hover:text-rose-500 shrink-0"><X className="w-4 h-4" /></button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="bg-white border border-slate-200 rounded-3xl p-10 space-y-4">
                            <label className="text-sm font-semibold text-slate-700">URL del documento (PDF o imagen)</label>
                            <input type="url" placeholder="https://proveedor.com/ficha-tecnica.pdf" value={url} onChange={e => { setUrl(e.target.value); scheduleAutoSave(); }}
                                className="w-full p-4 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono" />
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700">
                            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" /><p className="text-sm">{errorMsg}</p>
                        </div>
                    )}

                    {/* Botones de acción */}
                    {canProcess && (
                        <div className={cn('flex gap-3', isMobile && 'flex-col')}>
                            <button type="button" onClick={handleProcess} disabled={isProcessing}
                                className="flex-1 py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-3 shadow-lg shadow-indigo-100 disabled:opacity-60 text-base">
                                {status === 'uploading' ? <><Loader2 className="w-5 h-5 animate-spin" /> Subiendo archivos…</>
                                    : status === 'processing' ? <><Loader2 className="w-5 h-5 animate-spin" /> Procesando{files.length > 1 ? ` ${files.length} documentos` : ''}…</>
                                    : <><Sparkles className="w-5 h-5" /> Estructurar con IA{files.length > 1 ? ` (${files.filter(f=>!f.error).length})` : ''}</>}
                            </button>
                            <button type="button" onClick={guardarBorrador} disabled={isProcessing}
                                className="py-4 px-5 bg-slate-100 text-slate-700 font-bold rounded-2xl hover:bg-slate-200 transition-all flex items-center justify-center gap-2 disabled:opacity-60 text-sm whitespace-nowrap">
                                <Clock className="w-4 h-4" /> Guardar borrador
                            </button>
                            {/* Eliminar borrador activo */}
                            {currentBorrador && (
                                <button type="button"
                                    onClick={async (e) => {
                                        if (!window.confirm('¿Eliminar este borrador? Esta acción no se puede deshacer.')) return;
                                        await eliminarBorrador(currentBorrador, e as any);
                                        handleReset();
                                    }}
                                    className="py-4 px-4 bg-rose-50 text-rose-600 font-bold rounded-2xl hover:bg-rose-100 transition-all flex items-center justify-center gap-2 text-sm whitespace-nowrap border border-rose-200">
                                    <Trash2 className="w-4 h-4" /> Eliminar
                                </button>
                            )}
                        </div>
                    )}
                </>
            ) : (
                <div className="space-y-6">
                    {/* BLOQUE 4: Grid responsive — 2 cols desktop, 1 col mobile */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Preview */}
                        <div className="bg-slate-50 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[360px] border border-slate-200 gap-4">
                            {(() => {
                                const img = files.find(f => f.file.type.startsWith('image/'));
                                return img
                                    // eslint-disable-next-line @next/next/no-img-element
                                    ? <img src={URL.createObjectURL(img.file)} alt="Preview" className="max-h-72 object-contain rounded-xl shadow" />
                                    : <div className="text-center text-slate-400">
                                        <Camera className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                        <p className="text-sm font-medium">{files.length > 1 ? `${files.length} documentos` : files[0]?.file.name || url.split('/').pop()}</p>
                                    </div>;
                            })()}
                            <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-full border border-slate-200 shadow-sm">
                                <span className="text-xs text-slate-500">Confianza:</span>
                                <ConfidenceBadge value={result.confidence} />
                            </div>
                        </div>

                        {/* Formulario — campo grid-cols-1 en mobile */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm space-y-5 overflow-y-auto max-h-[80vh]">
                            <div className="flex justify-between items-center">
                                <h3 className="text-xl font-bold flex items-center gap-2"><Sparkles className="w-5 h-5 text-indigo-500" /> Datos Extraídos</h3>
                                <button onClick={handleReset} className="text-slate-400 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button>
                            </div>

                            <div className="space-y-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-1">Identificación</p>
                                <Field
                                    label="N.º de parte / Modelo (detectado por IA)"
                                    value={edited?.sku_detectado}
                                    onChange={v => updateField('sku_detectado', v)}
                                    mono
                                />
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                        SKU de tienda (articulo_id)
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm font-mono focus:ring-1 focus:ring-amber-400 outline-none placeholder-amber-300"
                                        placeholder={`Ej: ${edited?.marca?.slice(0,3).toUpperCase() ?? 'MRC'}-${edited?.sku_detectado ?? 'MODELO'}`}
                                        value={(edited as any)?.sku_tienda ?? ''}
                                        onChange={e => updateField('sku_tienda' as any, e.target.value)}
                                    />
                                    <p className="text-[10px] text-amber-600">Este será el ID de tu catálogo. Déjalo vacío para usar el N.º de parte detectado.</p>
                                </div>
                                <Field label="Nombre del Producto" value={edited?.nombre} onChange={v => updateField('nombre', v)} />
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <Field label="Marca" value={edited?.marca} onChange={v => updateField('marca', v)} />
                                    <Field label="Fabricante" value={edited?.fabricante} onChange={v => updateField('fabricante', v)} />
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <Field label="Modelo" value={edited?.modelo} onChange={v => updateField('modelo', v)} />
                                    <Field label="Variante" value={edited?.variante} onChange={v => updateField('variante', v)} />
                                </div>
                                <Field label="Categoría" value={edited?.categoria} onChange={v => updateField('categoria', v)} />
                            </div>
                            <div className="space-y-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-1">Códigos</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <Field label="EAN / UPC / GTIN" value={edited?.codigo_universal} onChange={v => updateField('codigo_universal', v)} mono />
                                    <Field label="Clave SAT" value={edited?.codigo_sat} onChange={v => updateField('codigo_sat', v)} mono />
                                </div>
                            </div>
                            <div className="space-y-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-1">Dimensiones</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="Largo (cm)" value={edited?.largo_cm} onChange={v => updateField('largo_cm', parseFloat(v) || undefined as any)} type="number" />
                                    <Field label="Ancho (cm)" value={edited?.ancho_cm} onChange={v => updateField('ancho_cm', parseFloat(v) || undefined as any)} type="number" />
                                    <Field label="Alto (cm)"  value={edited?.alto_cm}  onChange={v => updateField('alto_cm',  parseFloat(v) || undefined as any)} type="number" />
                                    <Field label="Peso (kg)"  value={edited?.peso_kg}  onChange={v => updateField('peso_kg',  parseFloat(v) || undefined as any)} type="number" />
                                </div>
                                <Field label="País de Origen" value={edited?.pais_origen} onChange={v => updateField('pais_origen', v)} />
                                <Field label="Materiales" value={edited?.materiales} onChange={v => updateField('materiales', v)} />
                            </div>
                            <div className="space-y-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-1">Descripción</p>
                                <Field label="Descripción técnica (corta)" value={edited?.descripcion} onChange={v => updateField('descripcion', v)} type="textarea" />
                                <Field label="Descripción extendida" value={edited?.descripcion_larga} onChange={v => updateField('descripcion_larga', v)} type="textarea" />
                                <Field label="Especificaciones" value={edited?.especificaciones} onChange={v => updateField('especificaciones', v)} type="textarea" />
                            </div>
                            <div className="space-y-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-1">Uso y Seguridad</p>
                                <Field label="Uso recomendado" value={edited?.uso_recomendado} onChange={v => updateField('uso_recomendado', v)} type="textarea" />
                                <Field label="Precauciones" value={edited?.precauciones} onChange={v => updateField('precauciones', v)} type="textarea" />
                                <Field label="Ingredientes / Composición" value={edited?.ingredientes} onChange={v => updateField('ingredientes', v)} type="textarea" />
                            </div>
                            <div className="space-y-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-1">Marketplaces</p>
                                {/* Bullet points — lista editable */}
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Puntos clave (bullet points)</label>
                                    {(edited?.bullet_points ?? []).map((bp, i) => (
                                        <div key={i} className="flex gap-2">
                                            <input value={bp} onChange={e => {
                                                const arr = [...(edited?.bullet_points ?? [])];
                                                arr[i] = e.target.value;
                                                updateField('bullet_points', arr as any);
                                            }} className="flex-1 p-2 bg-slate-50 border border-slate-100 rounded-lg text-sm focus:ring-1 focus:ring-indigo-500 outline-none" />
                                            <button type="button" onClick={() => {
                                                const arr = (edited?.bullet_points ?? []).filter((_, j) => j !== i);
                                                updateField('bullet_points', arr as any);
                                            }} className="text-slate-300 hover:text-rose-500"><X className="w-3 h-3" /></button>
                                        </div>
                                    ))}
                                    <button type="button" onClick={() => updateField('bullet_points', [...(edited?.bullet_points ?? []), ''] as any)}
                                        className="text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-1">
                                        <Plus className="w-3 h-3" /> Agregar punto
                                    </button>
                                </div>
                                {/* Palabras clave */}
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Palabras clave</label>
                                    <div className="flex flex-wrap gap-2">
                                        {(edited?.palabras_clave ?? []).map((kw, i) => (
                                            <span key={i} className="flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs px-2 py-1 rounded-full">
                                                {kw}
                                                <button type="button" onClick={() => updateField('palabras_clave', (edited?.palabras_clave ?? []).filter((_, j) => j !== i) as any)}
                                                    className="hover:text-rose-500"><X className="w-2.5 h-2.5" /></button>
                                            </span>
                                        ))}
                                    </div>
                                    <input placeholder="Agregar keyword y Enter" onKeyDown={e => {
                                        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                            updateField('palabras_clave', [...(edited?.palabras_clave ?? []), e.currentTarget.value.trim()] as any);
                                            e.currentTarget.value = '';
                                        }
                                    }} className="w-full p-2 bg-slate-50 border border-slate-100 rounded-lg text-sm focus:ring-1 focus:ring-indigo-500 outline-none" />
                                </div>
                            </div>

                            {/* SECCIÓN A — Atributos de Categoría (plantilla dinámica v4) */}
                            <div className="space-y-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-1">
                                    Atributos de {edited?.categoria || 'Categoría'}
                                </p>
                                {plantillaCampos.length === 0 ? (
                                    <p className="text-xs text-slate-400">Sin plantilla definida para esta categoría</p>
                                ) : (
                                    plantillaCampos.map((campo: any) => (
                                        <Field
                                            key={campo.key}
                                            label={`${campo.label}${campo.unidad ? ` (${campo.unidad})` : ''}`}
                                            value={atribCategoria[campo.key]}
                                            onChange={v => { setAtribCategoria(prev => ({ ...prev, [campo.key]: v })); scheduleAutoSave(); }}
                                            type={campo.tipo === 'number' ? 'number' : campo.tipo === 'textarea' ? 'textarea' : 'text'}
                                        />
                                    ))
                                )}
                            </div>

                            {/* SECCIÓN B — Otros atributos detectados (key-value editable) */}
                            <div className="space-y-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-1">
                                    Otros atributos detectados
                                </p>
                                {Object.keys(atribExtras).length === 0 ? (
                                    <p className="text-xs text-slate-400">La IA no detectó atributos adicionales</p>
                                ) : (
                                    Object.entries(atribExtras).map(([key, val]) => (
                                        <div key={key} className="flex gap-2 items-center">
                                            <input value={key} readOnly
                                                className="w-1/3 p-2 bg-slate-50 border border-slate-100 rounded-lg text-xs font-mono text-slate-500" />
                                            <input value={String(val ?? '')}
                                                onChange={e => { setAtribExtras(prev => ({ ...prev, [key]: e.target.value })); scheduleAutoSave(); }}
                                                className="flex-1 p-2 bg-slate-50 border border-slate-100 rounded-lg text-xs focus:ring-1 focus:ring-indigo-400 outline-none" />
                                            <button onClick={() => setAtribExtras(prev => { const n = { ...prev }; delete n[key]; return n; })}
                                                className="text-slate-300 hover:text-rose-500 shrink-0">
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>

                            {status === 'error' && (
                                <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm">
                                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{errorMsg}
                                </div>
                            )}

                            <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-3">
                                <button onClick={handleSave} disabled={isSaving || isSaved}
                                    className="flex-1 bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-60">
                                    {isSaved ? <><CheckCircle2 className="w-5 h-5" /> ¡Guardado!</>
                                        : isSaving ? <><Loader2 className="w-5 h-5 animate-spin" /> Guardando…</>
                                        : <><Save className="w-5 h-5" /> Guardar en Catálogo</>}
                                </button>
                                <button onClick={handleReset} className="px-5 py-3 bg-slate-50 text-slate-600 font-bold rounded-xl hover:bg-slate-100">Descartar</button>
                            </div>
                        </div>
                    </div>

                    {/* ── Panel vinculación manual (BLOQUE 1 cards enriquecidas + BLOQUE 2 buscador) */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                            <div>
                                <h3 className="text-base font-bold flex items-center gap-2"><Link2 className="w-4 h-4 text-indigo-500" /> Vincular a artículo del catálogo</h3>
                                <p className="text-xs text-slate-400 mt-0.5">Tú decides. La IA solo sugiere — busca manualmente o elige "Crear como nuevo".</p>
                            </div>
                            {suggestions.length > 0 && (
                                <button onClick={() => setShowSuggestions(p => !p)} className="text-xs text-slate-500 flex items-center gap-1 hover:text-slate-700">
                                    {suggestions.length} sugerencia{suggestions.length !== 1 ? 's' : ''} de IA <ChevronDown className={cn('w-3 h-3 transition-transform', showSuggestions && 'rotate-180')} />
                                </button>
                            )}
                        </div>

                        {/* Artículo seleccionado */}
                        {linkedArticulo ? (
                            <div className="flex items-start gap-3 p-4 bg-indigo-50 border border-indigo-200 rounded-xl">
                                <CheckCircle2 className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                                <div className="flex-1">
                                    <p className="text-sm font-bold text-indigo-800">{linkedArticulo.nombre}</p>
                                    <p className="text-xs text-indigo-600 font-mono mt-0.5">{linkedArticulo.articulo_id} — {linkedArticulo.marca}</p>
                                    <div className="flex flex-wrap items-center gap-2 mt-2">
                                        <span className="text-xs text-slate-500">Modo:</span>
                                        {(['update', 'link_only'] as const).map(m => (
                                            <button key={m} onClick={() => setSaveMode(m)}
                                                className={cn('text-xs px-2 py-1 rounded-lg border font-medium transition-colors',
                                                    saveMode === m ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300')}>
                                                {m === 'update' ? '📝 Rellenar vacíos' : '🔗 Solo vincular'}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <button onClick={() => { setLinkedArticulo(null); setSaveMode('create'); }} className="text-slate-400 hover:text-rose-500"><X className="w-4 h-4" /></button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3 p-3 bg-slate-50 border border-dashed border-slate-300 rounded-xl">
                                <Plus className="w-4 h-4 text-indigo-500" />
                                <p className="text-sm text-slate-600 flex-1">
                                    <span className="font-semibold text-indigo-600">Crear como nuevo artículo</span> — SKU: <span className="font-mono text-xs bg-slate-200 px-1 rounded">{edited?.sku_detectado}</span>
                                </p>
                            </div>
                        )}

                        {/* Sugerencias IA con ArticuloCard enriquecida (BLOQUE 1) */}
                        {showSuggestions && suggestions.length > 0 && (
                            <div className="space-y-2">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sugerencias de la IA (solo informativas)</p>
                                {suggestions.slice(0, 5).map(s => (
                                    <ArticuloCard key={s.articulo_id} match={s} onSelect={selectArticulo} />
                                ))}
                            </div>
                        )}

                        {/* Buscador manual */}
                        <div className="space-y-3">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Búsqueda manual</p>
                            <div className="flex gap-2">
                                <input type="text" placeholder="SKU, EAN, nombre del producto…" value={searchQ}
                                    onChange={e => setSearchQ(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleManualSearch()}
                                    className="flex-1 p-3 border border-slate-200 rounded-xl text-sm focus:ring-1 focus:ring-indigo-500 outline-none font-mono" />
                                <button onClick={handleManualSearch} disabled={searchLoading || searchQ.trim().length < 2}
                                    className="px-4 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
                                    {searchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                                </button>
                            </div>
                            {/* Resultados de búsqueda con ArticuloCard enriquecida (BLOQUE 1) */}
                            {searchResults.length > 0 && (
                                <div className="space-y-2 max-h-96 overflow-y-auto">
                                    {searchResults.map(r => (
                                        <ArticuloCard key={r.articulo_id} match={r} onSelect={selectArticulo} />
                                    ))}
                                </div>
                            )}
                            {searchResults.length === 0 && searchQ.trim().length >= 2 && !searchLoading && (
                                <button onClick={() => { setLinkedArticulo(null); setSaveMode('create'); setSearchResults([]); setSearchQ(''); }}
                                    className="w-full p-3 border-2 border-dashed border-indigo-300 rounded-xl text-sm text-indigo-600 font-semibold hover:bg-indigo-50 flex items-center justify-center gap-2">
                                    <Plus className="w-4 h-4" /> Sin resultados — Crear como artículo nuevo
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
