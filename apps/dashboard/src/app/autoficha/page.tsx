"use client";

import { useState, useCallback, useRef } from 'react';
import { Upload, Sparkles, CheckCircle2, Save, Trash2, Camera, Loader2, AlertCircle, Search, X, FileText, Image as ImageIcon } from 'lucide-react';
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
            {type === 'textarea' ? (
                <textarea className={cn(cls, 'h-24 resize-none')} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
            ) : (
                <input type={type} className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
            )}
        </div>
    );
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

type InputMode = 'file' | 'url';
type Status    = 'idle' | 'uploading' | 'processing' | 'done' | 'saving' | 'saved' | 'error';

interface FileEntry {
    file:        File;
    progress:    number;        // 0-100
    storagePath?: string;
    storageUrl?:  string;
    error?:       string;
}

const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const MAX_MB       = 50;

// ─── Página principal ─────────────────────────────────────────────────────────

export default function AutofichaPage() {
    const [inputMode, setInputMode]     = useState<InputMode>('file');
    const [files, setFiles]             = useState<FileEntry[]>([]);
    const [url, setUrl]                 = useState('');
    const [status, setStatus]           = useState<Status>('idle');
    const [errorMsg, setErrorMsg]       = useState('');
    const [result, setResult]           = useState<AutofichaResult | null>(null);
    const [edited, setEdited]           = useState<AutofichaResult | null>(null);
    const [catalogMatch, setCatalogMatch] = useState<{ articulo_id: string; nombre: string; marca: string; score: string } | null>(null);
    const [dragOver, setDragOver]       = useState(false);
    const inputRef                      = useRef<HTMLInputElement>(null);

    // ── Actualizar campo individual ───────────────────────────────────────────

    function updateField<K extends keyof AutofichaResult>(key: K, value: AutofichaResult[K]) {
        setEdited(prev => prev ? { ...prev, [key]: value } : prev);
    }

    // ── Agregar archivos (con validación) ─────────────────────────────────────

    function addFiles(newFiles: FileList | File[]) {
        const entries: FileEntry[] = [];
        for (const f of Array.from(newFiles)) {
            if (!ALLOWED_MIME.includes(f.type)) {
                entries.push({ file: f, progress: 0, error: `Formato no soportado: ${f.type}` });
            } else if (f.size > MAX_MB * 1e6) {
                entries.push({ file: f, progress: 0, error: `Demasiado grande (${(f.size / 1e6).toFixed(1)} MB). Máx ${MAX_MB} MB` });
            } else {
                entries.push({ file: f, progress: 0 });
            }
        }
        setFiles(prev => {
            const next = [...prev, ...entries];
            return next.slice(0, 10); // máx 10 archivos
        });
    }

    function removeFile(idx: number) {
        setFiles(prev => prev.filter((_, i) => i !== idx));
    }

    // ── Drag & drop ───────────────────────────────────────────────────────────

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    }, []);

    // ── Fase 1: Subir archivos directamente a Supabase Storage ───────────────

    async function uploadFilesToStorage(entries: FileEntry[]): Promise<FileEntry[]> {
        const updated = [...entries];
        for (let i = 0; i < updated.length; i++) {
            const entry = updated[i];
            if (entry.error) continue; // saltar archivos con errores de validación

            const ts   = Date.now();
            const path = `autofichas/${ts}_${entry.file.name}`;
            setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, progress: 30 } : f));

            try {
                const { error } = await supabase.storage
                    .from('documentos-fuente')
                    .upload(path, entry.file, { contentType: entry.file.type, upsert: false });

                if (error) throw error;

                // Obtener URL pública (o signed URL si el bucket es privado)
                const { data: urlData } = supabase.storage
                    .from('documentos-fuente')
                    .getPublicUrl(path);

                updated[i] = { ...entry, progress: 100, storagePath: path, storageUrl: urlData.publicUrl };
                setFiles(prev => prev.map((f, idx) => idx === i ? updated[i] : f));
            } catch (err: any) {
                updated[i] = { ...entry, progress: 0, error: err?.message || 'Error al subir' };
                setFiles(prev => prev.map((f, idx) => idx === i ? updated[i] : f));
            }
        }
        return updated;
    }

    // ── Fase 2: Enviar URLs a la API ──────────────────────────────────────────

    const handleProcess = useCallback(async () => {
        setStatus('uploading');
        setErrorMsg('');
        setCatalogMatch(null);

        try {
            let response: Response;

            if (inputMode === 'file') {
                if (files.length === 0) { setStatus('idle'); return; }

                const validFiles = files.filter(f => !f.error);
                if (validFiles.length === 0) {
                    setErrorMsg('Todos los archivos tienen errores. Revisa los formatos y tamaños.');
                    setStatus('error');
                    return;
                }

                // Fase 1: subir a Storage
                const uploaded = await uploadFilesToStorage(validFiles);
                const urls = uploaded.filter(f => f.storageUrl).map(f => f.storageUrl!);

                if (urls.length === 0) {
                    setErrorMsg('No se pudo subir ningún archivo a Storage. Verifica los permisos del bucket.');
                    setStatus('error');
                    return;
                }

                // Fase 2: enviar solo URLs a la API
                setStatus('processing');
                response = await fetch('/api/autoficha', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify(urls.length === 1 ? { url: urls[0] } : { urls }),
                });

            } else {
                // Modo URL directa
                if (!url.trim()) { setStatus('idle'); return; }
                setStatus('processing');
                response = await fetch('/api/autoficha', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ url: url.trim() }),
                });
            }

            const data = await response.json();

            if (!response.ok) {
                setErrorMsg(data.error || 'Error al procesar el documento.');
                setStatus('error');
                return;
            }

            const af = data as AutofichaResult;
            setResult(af);
            setEdited(af);
            setStatus('done');

            // Búsqueda automática en catálogo
            try {
                const params = new URLSearchParams();
                if (af.sku_detectado)    params.set('sku',    af.sku_detectado);
                if (af.codigo_universal) params.set('ean',    af.codigo_universal);
                if (af.modelo)           params.set('modelo', af.modelo);
                if (af.nombre)           params.set('nombre', af.nombre);
                const sr = await fetch(`/api/autoficha/search?${params}`);
                if (sr.ok) {
                    const { matches } = await sr.json();
                    if (matches?.length > 0) setCatalogMatch(matches[0]);
                }
            } catch { /* no bloquear si falla la búsqueda */ }

        } catch (err: any) {
            setErrorMsg(err?.message || 'Error de red al conectar con el servidor.');
            setStatus('error');
        }
    }, [files, url, inputMode]);

    // ── handleSave ── vía RPC transaccional ──────────────────────────────────

    const handleSave = useCallback(async () => {
        if (!edited) return;
        setStatus('saving');

        try {
            const articulo_id = edited.articulo_id || edited.sku_detectado;
            const primaryFile = files.find(f => f.storageUrl);

            const { error } = await supabase.rpc('guardar_ficha_autoficha', {
                p: {
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
                    // Auditoría
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
                setResult(null); setEdited(null);
                setFiles([]); setUrl('');
                setCatalogMatch(null);
                setStatus('idle');
            }, 2000);
        } catch (err: any) {
            setErrorMsg(err?.message || 'Error al guardar en el catálogo.');
            setStatus('error');
        }
    }, [edited, files, url, inputMode, result]);

    // ── Reset ─────────────────────────────────────────────────────────────────

    function handleReset() {
        setResult(null); setEdited(null);
        setFiles([]); setUrl('');
        setErrorMsg(''); setCatalogMatch(null);
        setStatus('idle');
    }

    // ── Render ────────────────────────────────────────────────────────────────

    const isProcessing = status === 'uploading' || status === 'processing';
    const isSaving     = status === 'saving';
    const isSaved      = status === 'saved';
    const canProcess   = inputMode === 'file'
        ? files.filter(f => !f.error).length > 0
        : url.trim().length > 0;

    return (
        <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-700">
            {/* Encabezado */}
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Crear con IA — Autofichas</h2>
                <p className="text-slate-500 text-lg">Digitaliza fichas técnicas y catálogos de proveedores en segundos.</p>
            </div>

            {!result ? (
                <>
                    {/* Selector de modo */}
                    <div className="flex gap-2">
                        <button
                            onClick={() => { setInputMode('file'); setFiles([]); }}
                            className={cn(
                                'px-4 py-2 rounded-xl text-sm font-semibold border transition-colors',
                                inputMode === 'file'
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                            )}
                        >📄 Subir archivos</button>
                        <button
                            onClick={() => { setInputMode('url'); setFiles([]); }}
                            className={cn(
                                'px-4 py-2 rounded-xl text-sm font-semibold border transition-colors',
                                inputMode === 'url'
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                            )}
                        >🔗 URL de documento</button>
                    </div>

                    {/* Zona de entrada */}
                    {inputMode === 'file' ? (
                        <div className="space-y-4">
                            {/* Drop zone */}
                            <div
                                className={cn(
                                    'relative bg-white border-2 border-dashed rounded-3xl p-12 flex flex-col items-center justify-center text-center gap-4 transition-all cursor-pointer',
                                    dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-indigo-400'
                                )}
                                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                                onDragLeave={() => setDragOver(false)}
                                onDrop={onDrop}
                                onClick={() => inputRef.current?.click()}
                            >
                                <input
                                    ref={inputRef}
                                    type="file"
                                    accept=".pdf,.png,.jpg,.jpeg,.webp"
                                    multiple
                                    className="hidden"
                                    onChange={(e) => e.target.files && addFiles(e.target.files)}
                                />
                                <div className={cn(
                                    'w-16 h-16 rounded-2xl flex items-center justify-center transition-colors',
                                    dragOver ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-50 text-slate-400'
                                )}>
                                    <Upload className="w-8 h-8" />
                                </div>
                                <div>
                                    <p className="font-bold text-lg text-slate-700">
                                        {dragOver ? 'Suelta los archivos' : 'Arrastra o haz clic para seleccionar'}
                                    </p>
                                    <p className="text-slate-400 text-sm mt-1">PDF, PNG, JPEG, WEBP · máx. 50 MB por archivo · hasta 10 archivos</p>
                                </div>
                            </div>

                            {/* Lista de archivos seleccionados */}
                            {files.length > 0 && (
                                <div className="space-y-2">
                                    {files.map((entry, i) => (
                                        <div key={i} className={cn(
                                            'flex items-center gap-3 p-3 rounded-xl border text-sm',
                                            entry.error ? 'bg-rose-50 border-rose-200' :
                                            entry.progress === 100 ? 'bg-emerald-50 border-emerald-200' :
                                            'bg-white border-slate-200'
                                        )}>
                                            {entry.file.type.startsWith('image/')
                                                ? <ImageIcon className="w-4 h-4 text-slate-400 shrink-0" />
                                                : <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                                            }
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium truncate">{entry.file.name}</p>
                                                {entry.error ? (
                                                    <p className="text-rose-600 text-xs">{entry.error}</p>
                                                ) : entry.progress === 100 ? (
                                                    <p className="text-emerald-600 text-xs">✓ Subido a Storage</p>
                                                ) : entry.progress > 0 ? (
                                                    <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                        <div className="h-full bg-indigo-500 transition-all" style={{ width: `${entry.progress}%` }} />
                                                    </div>
                                                ) : (
                                                    <p className="text-slate-400 text-xs">{(entry.file.size / 1e6).toFixed(1)} MB</p>
                                                )}
                                            </div>
                                            <button onClick={() => removeFile(i)} className="text-slate-300 hover:text-rose-500 transition-colors shrink-0">
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="bg-white border border-slate-200 rounded-3xl p-10 space-y-4">
                            <label className="text-sm font-semibold text-slate-700">URL del documento (PDF o imagen)</label>
                            <input
                                type="url"
                                placeholder="https://proveedor.com/ficha-tecnica.pdf"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                className="w-full p-4 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                            />
                            <p className="text-xs text-slate-400">El sistema descargará y procesará el documento automáticamente.</p>
                        </div>
                    )}

                    {/* Error */}
                    {status === 'error' && (
                        <div className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700">
                            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                            <p className="text-sm">{errorMsg}</p>
                        </div>
                    )}

                    {/* Botón Procesar */}
                    {canProcess && (
                        <button
                            onClick={handleProcess}
                            disabled={isProcessing}
                            className="w-full py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-3 shadow-lg shadow-indigo-100 disabled:opacity-60 text-lg"
                        >
                            {status === 'uploading'
                                ? <><Loader2 className="w-5 h-5 animate-spin" /> Subiendo archivos a Storage…</>
                                : status === 'processing'
                                    ? <><Loader2 className="w-5 h-5 animate-spin" /> La IA está procesando{files.length > 1 ? ` ${files.length} documentos` : ' el documento'}…</>
                                    : <><Sparkles className="w-5 h-5" /> Estructurar con IA{files.length > 1 ? ` (${files.filter(f=>!f.error).length} archivos)` : ''}</>
                            }
                        </button>
                    )}
                </>
            ) : (
                /* ── Panel de resultados ──────────────────────────────────── */
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Preview */}
                    <div className="bg-slate-50 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[400px] border border-slate-200 gap-4">
                        {(() => {
                            const imageFile = files.find(f => f.file.type.startsWith('image/'));
                            return imageFile ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={URL.createObjectURL(imageFile.file)} alt="Preview" className="max-h-80 object-contain rounded-xl shadow" />
                            ) : (
                                <div className="text-center text-slate-400">
                                    <Camera className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                    <p className="text-sm font-medium">
                                        {files.length > 1 ? `${files.length} documentos procesados` : files[0]?.file.name || url.split('/').pop()}
                                    </p>
                                    <p className="text-xs text-slate-300 mt-1">Vista previa no disponible para PDF</p>
                                </div>
                            );
                        })()}
                        <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-full border border-slate-200 shadow-sm">
                            <span className="text-xs text-slate-500">Confianza global:</span>
                            <ConfidenceBadge value={result.confidence} />
                        </div>
                        {files.length > 1 && (
                            <p className="text-xs text-slate-400 text-center">Ficha consolidada de {files.length} documentos</p>
                        )}
                    </div>

                    {/* Formulario de resultados */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm space-y-5 overflow-y-auto max-h-[80vh]">
                        <div className="flex justify-between items-center">
                            <h3 className="text-xl font-bold flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-indigo-500" />
                                Datos Extraídos
                            </h3>
                            <button onClick={handleReset} className="text-slate-400 hover:text-rose-500 transition-colors">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Banner: artículo encontrado en catálogo */}
                        {catalogMatch && (
                            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
                                <Search className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                                <div className="flex-1 text-sm">
                                    <p className="font-semibold text-amber-800">
                                        {catalogMatch.score === 'exact' ? '⚡ SKU exacto' :
                                         catalogMatch.score === 'ean'   ? '✅ EAN/UPC coincide' :
                                         catalogMatch.score === 'model' ? '🔍 Modelo similar' : '📋 Nombre similar'} encontrado en catálogo
                                    </p>
                                    <p className="text-amber-700 text-xs mt-0.5">
                                        <span className="font-mono">{catalogMatch.articulo_id}</span> — {catalogMatch.nombre} ({catalogMatch.marca})
                                    </p>
                                    <p className="text-amber-600 text-xs mt-1">Guardar actualizará solo los campos vacíos del artículo existente.</p>
                                </div>
                                <button onClick={() => setCatalogMatch(null)} className="text-amber-400 hover:text-amber-600 text-xs">✕</button>
                            </div>
                        )}

                        {/* Sección: Identificación */}
                        <div className="space-y-3">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-1">Identificación</p>
                            <Field label="SKU Detectado" value={edited?.sku_detectado} onChange={(v) => updateField('sku_detectado', v)} mono />
                            <Field label="Nombre del Producto" value={edited?.nombre} onChange={(v) => updateField('nombre', v)} />
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Marca" value={edited?.marca} onChange={(v) => updateField('marca', v)} />
                                <Field label="Modelo" value={edited?.modelo} onChange={(v) => updateField('modelo', v)} />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Variante" value={edited?.variante} onChange={(v) => updateField('variante', v)} />
                                <Field label="Categoría" value={edited?.categoria} onChange={(v) => updateField('categoria', v)} />
                            </div>
                        </div>

                        {/* Sección: Códigos */}
                        <div className="space-y-3">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-1">Códigos</p>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="EAN / UPC / GTIN" value={edited?.codigo_universal} onChange={(v) => updateField('codigo_universal', v)} mono />
                                <Field label="Clave SAT" value={edited?.codigo_sat} onChange={(v) => updateField('codigo_sat', v)} mono />
                            </div>
                        </div>

                        {/* Sección: Dimensiones */}
                        <div className="space-y-3">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-1">Dimensiones</p>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Largo (cm)" value={edited?.largo_cm} onChange={(v) => updateField('largo_cm', parseFloat(v) || undefined as any)} type="number" />
                                <Field label="Ancho (cm)"  value={edited?.ancho_cm} onChange={(v) => updateField('ancho_cm',  parseFloat(v) || undefined as any)} type="number" />
                                <Field label="Alto (cm)"   value={edited?.alto_cm}  onChange={(v) => updateField('alto_cm',   parseFloat(v) || undefined as any)} type="number" />
                                <Field label="Peso (kg)"   value={edited?.peso_kg}  onChange={(v) => updateField('peso_kg',   parseFloat(v) || undefined as any)} type="number" />
                            </div>
                        </div>

                        {/* Sección: Descripción */}
                        <div className="space-y-3">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-1">Descripción</p>
                            <Field label="Materiales" value={edited?.materiales} onChange={(v) => updateField('materiales', v)} />
                            <Field label="País de Origen" value={edited?.pais_origen} onChange={(v) => updateField('pais_origen', v)} />
                            <Field label="Descripción Técnica" value={edited?.descripcion} onChange={(v) => updateField('descripcion', v)} type="textarea" />
                        </div>

                        {/* Error en guardado */}
                        {status === 'error' && (
                            <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm">
                                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                {errorMsg}
                            </div>
                        )}

                        {/* Acciones */}
                        <div className="pt-4 border-t border-slate-100 flex gap-3">
                            <button
                                onClick={handleSave}
                                disabled={isSaving || isSaved}
                                className="flex-1 bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-60"
                            >
                                {isSaved
                                    ? <><CheckCircle2 className="w-5 h-5" /> ¡Guardado!</>
                                    : isSaving
                                        ? <><Loader2 className="w-5 h-5 animate-spin" /> Guardando…</>
                                        : <><Save className="w-5 h-5" /> Guardar en Catálogo</>
                                }
                            </button>
                            <button onClick={handleReset} className="px-5 py-3 bg-slate-50 text-slate-600 font-bold rounded-xl hover:bg-slate-100 transition-all">
                                Descartar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
