"use client";

import { useState, useCallback, useRef } from 'react';
import {
    Upload, Sparkles, CheckCircle2, Save, Trash2, Camera,
    Loader2, AlertCircle, Search, X, FileText, Image as ImageIcon,
    Link2, Plus, ChevronDown,
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
                  score >= 60 ? 'bg-amber-100 text-amber-700'    :
                                'bg-slate-100 text-slate-500';
    return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${color}`}>{label} ({score})</span>;
}

// ─── Campo controlado ─────────────────────────────────────────────────────────

interface FieldProps {
    label: string;
    value: string | number | undefined;
    onChange: (v: string) => void;
    type?: 'text' | 'number' | 'textarea';
    mono?: boolean;
}

function Field({ label, value, onChange, type = 'text', mono = false }: FieldProps) {
    const cls = cn(
        'w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:ring-1 focus:ring-indigo-500 outline-none',
        mono && 'font-mono'
    );
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

// ─── Tipos ────────────────────────────────────────────────────────────────────

type InputMode = 'file' | 'url';
type Status    = 'idle' | 'uploading' | 'processing' | 'done' | 'saving' | 'saved' | 'error';
type SaveMode  = 'create' | 'update' | 'link_only';

interface ArticuloMatch {
    articulo_id: string; nombre: string; marca: string;
    modelo?: string; categoria?: string;
    codigo_universal?: string;
    score: number; score_label: string;
}

interface FileEntry {
    file: File; progress: number;
    storagePath?: string; storageUrl?: string; error?: string;
}

const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const MAX_MB = 50;

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
    // Vinculación al catálogo (MANUAL — el operador decide)
    const [suggestions, setSuggestions]   = useState<ArticuloMatch[]>([]);  // sugerencias IA (informativas)
    const [searchQ, setSearchQ]           = useState('');
    const [searchResults, setSearchResults] = useState<ArticuloMatch[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [linkedArticulo, setLinkedArticulo] = useState<ArticuloMatch | null>(null); // lo que el operador eligió
    const [saveMode, setSaveMode]         = useState<SaveMode>('update');
    // UI
    const [dragOver, setDragOver]     = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const inputRef                    = useRef<HTMLInputElement>(null);

    // ── Edición de campos ─────────────────────────────────────────────────────

    function updateField<K extends keyof AutofichaResult>(key: K, value: AutofichaResult[K]) {
        setEdited(prev => prev ? { ...prev, [key]: value } : prev);
    }

    // ── Archivos ──────────────────────────────────────────────────────────────

    function addFiles(newFiles: FileList | File[]) {
        const entries: FileEntry[] = [];
        for (const f of Array.from(newFiles)) {
            if (!ALLOWED_MIME.includes(f.type)) entries.push({ file: f, progress: 0, error: `Formato no soportado: ${f.type}` });
            else if (f.size > MAX_MB * 1e6) entries.push({ file: f, progress: 0, error: `Demasiado grande (${(f.size / 1e6).toFixed(1)} MB). Máx ${MAX_MB} MB` });
            else entries.push({ file: f, progress: 0 });
        }
        setFiles(prev => [...prev, ...entries].slice(0, 10));
    }

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault(); setDragOver(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    }, []);

    // ── Subir a Storage ───────────────────────────────────────────────────────

    async function uploadFilesToStorage(entries: FileEntry[]): Promise<FileEntry[]> {
        const updated = [...entries];
        for (let i = 0; i < updated.length; i++) {
            const entry = updated[i];
            if (entry.error) continue;
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

        try {
            let response: Response;
            if (inputMode === 'file') {
                const validFiles = files.filter(f => !f.error);
                if (validFiles.length === 0) { setStatus('idle'); return; }
                const uploaded = await uploadFilesToStorage(validFiles);
                const urls = uploaded.filter(f => f.storageUrl).map(f => f.storageUrl!);
                if (urls.length === 0) { setErrorMsg('No se pudo subir ningún archivo a Storage.'); setStatus('error'); return; }
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

            // Sugerencias automáticas (solo informativas — el operador vincula manualmente)
            try {
                const params = new URLSearchParams();
                if (af.sku_detectado)    params.set('sku',    af.sku_detectado);
                if (af.codigo_universal) params.set('ean',    af.codigo_universal);
                if (af.modelo)           params.set('modelo', af.modelo);
                if (af.nombre)           params.set('nombre', af.nombre);
                const sr = await fetch(`/api/autoficha/search?${params}`);
                if (sr.ok) {
                    const { matches } = await sr.json();
                    if (matches?.length > 0) {
                        setSuggestions(matches);
                        setShowSuggestions(true);
                    }
                }
            } catch { /* no bloquear */ }

        } catch (err: any) {
            setErrorMsg(err?.message || 'Error de red.'); setStatus('error');
        }
    }, [files, url, inputMode]);

    // ── Búsqueda manual del operador ──────────────────────────────────────────

    const handleManualSearch = async () => {
        if (!searchQ.trim() || searchQ.trim().length < 2) return;
        setSearchLoading(true);
        try {
            const res = await fetch(`/api/autoficha/search?q=${encodeURIComponent(searchQ.trim())}`);
            if (res.ok) {
                const { matches } = await res.json();
                setSearchResults(matches ?? []);
            }
        } catch { /* silent */ }
        setSearchLoading(false);
    };

    function selectArticulo(match: ArticuloMatch, mode: SaveMode) {
        setLinkedArticulo(match);
        setSaveMode(mode);
        setSearchResults([]);
        setSearchQ('');
    }

    function createAsNew() {
        setLinkedArticulo(null);
        setSaveMode('create');
        setSearchResults([]);
        setSearchQ('');
    }

    // ── Guardar ───────────────────────────────────────────────────────────────

    const handleSave = useCallback(async () => {
        if (!edited) return;
        setStatus('saving');

        const articulo_id = linkedArticulo?.articulo_id || edited.articulo_id || edited.sku_detectado;
        const primaryFile = files.find(f => f.storageUrl);

        try {
            const { error } = await supabase.rpc('guardar_ficha_autoficha', {
                p: {
                    p_mode:           saveMode,
                    articulo_id,
                    sku_detectado:    edited.sku_detectado,
                    nombre:           edited.nombre           || null,
                    marca:            edited.marca            || null,
                    modelo:           edited.modelo           || null,
                    variante:         edited.variante         || null,
                    categoria:        edited.categoria        || null,
                    descripcion:      edited.descripcion      || null,
                    codigo_universal: edited.codigo_universal || null,
                    codigo_sat:       edited.codigo_sat       || null,
                    peso_kg:          edited.peso_kg          || null,
                    largo_cm:         edited.largo_cm         || null,
                    ancho_cm:         edited.ancho_cm         || null,
                    alto_cm:          edited.alto_cm          || null,
                    materiales:       edited.materiales       || null,
                    pais_origen:      edited.pais_origen      || null,
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
            setStatus('saved');
            setTimeout(() => {
                setResult(null); setEdited(null); setFiles([]); setUrl('');
                setSuggestions([]); setLinkedArticulo(null); setStatus('idle');
            }, 2000);
        } catch (err: any) {
            setErrorMsg(err?.message || 'Error al guardar.'); setStatus('error');
        }
    }, [edited, linkedArticulo, saveMode, files, url, inputMode, result]);

    // ── Reset ─────────────────────────────────────────────────────────────────

    function handleReset() {
        setResult(null); setEdited(null); setFiles([]); setUrl('');
        setErrorMsg(''); setSuggestions([]); setLinkedArticulo(null);
        setSearchQ(''); setSearchResults([]); setStatus('idle');
    }

    // ── Render ────────────────────────────────────────────────────────────────

    const isProcessing = status === 'uploading' || status === 'processing';
    const isSaving     = status === 'saving';
    const isSaved      = status === 'saved';
    const canProcess   = inputMode === 'file' ? files.filter(f => !f.error).length > 0 : url.trim().length > 0;

    return (
        <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-700">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Crear con IA — Autofichas</h2>
                <p className="text-slate-500 text-lg">Digitaliza fichas técnicas y catálogos de proveedores en segundos.</p>
            </div>

            {!result ? (
                <>
                    {/* Selector de modo */}
                    <div className="flex gap-2">
                        {(['file', 'url'] as const).map(m => (
                            <button key={m} onClick={() => { setInputMode(m); setFiles([]); }}
                                className={cn('px-4 py-2 rounded-xl text-sm font-semibold border transition-colors',
                                    inputMode === m ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                                )}>
                                {m === 'file' ? '📄 Subir archivos' : '🔗 URL de documento'}
                            </button>
                        ))}
                    </div>

                    {inputMode === 'file' ? (
                        <div className="space-y-4">
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
                            <input type="url" placeholder="https://proveedor.com/ficha-tecnica.pdf" value={url} onChange={e => setUrl(e.target.value)}
                                className="w-full p-4 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono" />
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700">
                            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" /><p className="text-sm">{errorMsg}</p>
                        </div>
                    )}

                    {canProcess && (
                        <button onClick={handleProcess} disabled={isProcessing}
                            className="w-full py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-3 shadow-lg shadow-indigo-100 disabled:opacity-60 text-lg">
                            {status === 'uploading' ? <><Loader2 className="w-5 h-5 animate-spin" /> Subiendo archivos a Storage…</>
                                : status === 'processing' ? <><Loader2 className="w-5 h-5 animate-spin" /> La IA está procesando{files.length > 1 ? ` ${files.length} documentos` : ' el documento'}…</>
                                : <><Sparkles className="w-5 h-5" /> Estructurar con IA{files.length > 1 ? ` (${files.filter(f=>!f.error).length} archivos)` : ''}</>}
                        </button>
                    )}
                </>
            ) : (
                <div className="space-y-6">
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
                                <span className="text-xs text-slate-500">Confianza global:</span>
                                <ConfidenceBadge value={result.confidence} />
                            </div>
                        </div>

                        {/* Formulario */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm space-y-5 overflow-y-auto max-h-[80vh]">
                            <div className="flex justify-between items-center">
                                <h3 className="text-xl font-bold flex items-center gap-2"><Sparkles className="w-5 h-5 text-indigo-500" /> Datos Extraídos</h3>
                                <button onClick={handleReset} className="text-slate-400 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button>
                            </div>

                            <div className="space-y-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-1">Identificación</p>
                                <Field label="SKU Detectado" value={edited?.sku_detectado} onChange={v => updateField('sku_detectado', v)} mono />
                                <Field label="Nombre del Producto" value={edited?.nombre} onChange={v => updateField('nombre', v)} />
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="Marca" value={edited?.marca} onChange={v => updateField('marca', v)} />
                                    <Field label="Modelo" value={edited?.modelo} onChange={v => updateField('modelo', v)} />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="Variante" value={edited?.variante} onChange={v => updateField('variante', v)} />
                                    <Field label="Categoría" value={edited?.categoria} onChange={v => updateField('categoria', v)} />
                                </div>
                            </div>
                            <div className="space-y-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-1">Códigos</p>
                                <div className="grid grid-cols-2 gap-3">
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
                            </div>
                            <div className="space-y-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-1">Descripción</p>
                                <Field label="Materiales" value={edited?.materiales} onChange={v => updateField('materiales', v)} />
                                <Field label="País de Origen" value={edited?.pais_origen} onChange={v => updateField('pais_origen', v)} />
                                <Field label="Descripción Técnica" value={edited?.descripcion} onChange={v => updateField('descripcion', v)} type="textarea" />
                            </div>

                            {status === 'error' && (
                                <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm">
                                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{errorMsg}
                                </div>
                            )}

                            <div className="pt-4 border-t border-slate-100 flex gap-3">
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

                    {/* ── Panel de vinculación al catálogo (MANUAL) ───────────── */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-base font-bold flex items-center gap-2"><Link2 className="w-4 h-4 text-indigo-500" /> Vincular a artículo del catálogo</h3>
                                <p className="text-xs text-slate-400 mt-0.5">Tú decides. Búscalo manualmente o elige "Crear como nuevo".</p>
                            </div>
                            {suggestions.length > 0 && (
                                <button onClick={() => setShowSuggestions(p => !p)} className="text-xs text-slate-500 flex items-center gap-1 hover:text-slate-700">
                                    Sugerencias IA ({suggestions.length}) <ChevronDown className={cn('w-3 h-3 transition-transform', showSuggestions && 'rotate-180')} />
                                </button>
                            )}
                        </div>

                        {/* Artículo seleccionado actualmente */}
                        {linkedArticulo ? (
                            <div className="flex items-start gap-3 p-4 bg-indigo-50 border border-indigo-200 rounded-xl">
                                <CheckCircle2 className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                                <div className="flex-1">
                                    <p className="text-sm font-bold text-indigo-800">{linkedArticulo.nombre}</p>
                                    <p className="text-xs text-indigo-600 font-mono mt-0.5">{linkedArticulo.articulo_id} — {linkedArticulo.marca}</p>
                                    <div className="flex items-center gap-2 mt-2">
                                        <span className="text-xs text-slate-500">Modo de guardado:</span>
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
                                    <span className="font-semibold text-indigo-600">Crear como nuevo artículo</span> — se usará el SKU detectado <span className="font-mono text-xs bg-slate-200 px-1 rounded">{edited?.sku_detectado}</span>
                                </p>
                            </div>
                        )}

                        {/* Sugerencias automáticas de la IA — solo informativas */}
                        {showSuggestions && suggestions.length > 0 && (
                            <div className="space-y-2">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sugerencias de la IA (elige una o búscala manualmente)</p>
                                {suggestions.slice(0, 5).map(s => (
                                    <div key={s.articulo_id} className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm">
                                        <div className="flex-1 min-w-0">
                                            <p className="font-semibold text-slate-800 truncate">{s.nombre}</p>
                                            <p className="text-xs text-slate-500 font-mono">{s.articulo_id} — {s.marca}</p>
                                        </div>
                                        <ScoreBadge score={s.score} label={s.score_label} />
                                        <div className="flex gap-1">
                                            <button onClick={() => selectArticulo(s, 'update')} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700">Actualizar</button>
                                            <button onClick={() => selectArticulo(s, 'link_only')} className="text-xs px-2 py-1 bg-slate-200 text-slate-700 rounded-lg font-semibold hover:bg-slate-300">Solo vincular</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Buscador manual */}
                        <div className="space-y-3">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Búsqueda manual</p>
                            <div className="flex gap-2">
                                <input type="text" placeholder="SKU, EAN, nombre del producto…" value={searchQ} onChange={e => setSearchQ(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleManualSearch()}
                                    className="flex-1 p-3 border border-slate-200 rounded-xl text-sm focus:ring-1 focus:ring-indigo-500 outline-none font-mono" />
                                <button onClick={handleManualSearch} disabled={searchLoading || searchQ.trim().length < 2}
                                    className="px-4 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
                                    {searchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                                </button>
                            </div>
                            {searchResults.length > 0 && (
                                <div className="space-y-2 max-h-60 overflow-y-auto">
                                    {searchResults.map(r => (
                                        <div key={r.articulo_id} className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-xl text-sm hover:border-indigo-300 transition-colors">
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold truncate">{r.nombre}</p>
                                                <p className="text-xs text-slate-500 font-mono">{r.articulo_id} — {r.marca}</p>
                                            </div>
                                            <ScoreBadge score={r.score} label={r.score_label} />
                                            <div className="flex gap-1">
                                                <button onClick={() => selectArticulo(r, 'update')} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold">Actualizar</button>
                                                <button onClick={() => selectArticulo(r, 'link_only')} className="text-xs px-2 py-1 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 font-semibold">Vincular</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {searchResults.length === 0 && searchQ.trim().length >= 2 && !searchLoading && (
                                <button onClick={createAsNew} className="w-full p-3 border-2 border-dashed border-indigo-300 rounded-xl text-sm text-indigo-600 font-semibold hover:bg-indigo-50 flex items-center justify-center gap-2">
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
