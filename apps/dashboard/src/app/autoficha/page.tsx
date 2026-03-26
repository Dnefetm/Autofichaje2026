"use client";

import { useState, useCallback } from 'react';
import { Upload, Sparkles, CheckCircle2, Save, Trash2, Camera, Link, Loader2, AlertCircle, Search } from 'lucide-react';
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

// ─── Sub-componente: Campo controlado ────────────────────────────────────────

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
                <textarea
                    className={cn(cls, 'h-24 resize-none')}
                    value={value ?? ''}
                    onChange={(e) => onChange(e.target.value)}
                />
            ) : (
                <input
                    type={type}
                    className={cls}
                    value={value ?? ''}
                    onChange={(e) => onChange(e.target.value)}
                />
            )}
        </div>
    );
}

// ─── Página principal ─────────────────────────────────────────────────────────

type InputMode = 'file' | 'url';
type Status = 'idle' | 'processing' | 'done' | 'saving' | 'saved' | 'error';

export default function AutofichaPage() {
    const [inputMode, setInputMode]   = useState<InputMode>('file');
    const [file, setFile]             = useState<File | null>(null);
    const [url, setUrl]               = useState('');
    const [status, setStatus]         = useState<Status>('idle');
    const [errorMsg, setErrorMsg]     = useState('');
    const [result, setResult]         = useState<AutofichaResult | null>(null);
    const [edited, setEdited]         = useState<AutofichaResult | null>(null);

    // ── Updaters de campos individuales ──────────────────────────────────────

    function updateField<K extends keyof AutofichaResult>(key: K, value: AutofichaResult[K]) {
        setEdited(prev => prev ? { ...prev, [key]: value } : prev);
    }

    // ── Procesar documento ───────────────────────────────────────────────────

    const handleProcess = useCallback(async () => {
        setStatus('processing');
        setErrorMsg('');

        try {
            let response: Response;

            if (inputMode === 'file') {
                if (!file) { setStatus('idle'); return; }
                const formData = new FormData();
                formData.append('file', file);
                response = await fetch('/api/autoficha', { method: 'POST', body: formData });
            } else {
                if (!url.trim()) { setStatus('idle'); return; }
                response = await fetch('/api/autoficha', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: url.trim() }),
                });
            }

            const data = await response.json();

            if (!response.ok) {
                setErrorMsg(data.error || 'Error al procesar el documento.');
                setStatus('error');
                return;
            }

            setResult(data as AutofichaResult);
            setEdited(data as AutofichaResult);
            setStatus('done');
        } catch (err: any) {
            setErrorMsg(err?.message || 'Error de red al conectar con el servidor.');
            setStatus('error');
        }
    }, [file, url, inputMode]);

    // ── Guardar en catálogo ──────────────────────────────────────────────────

    const handleSave = useCallback(async () => {
        if (!edited) return;
        setStatus('saving');

        try {
            const articulo_id = edited.articulo_id || edited.sku_detectado;

            // Upsert artículo en tabla articulos
            const { error: artError } = await supabase.from('articulos').upsert({
                articulo_id,
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
            }, { onConflict: 'articulo_id', ignoreDuplicates: false });

            if (artError) throw artError;

            // Snapshot de inventario (stock inicial = 0 si es nuevo)
            await supabase.from('inventory_snapshot').upsert(
                { sku: articulo_id, physical_stock: 0 },
                { onConflict: 'sku', ignoreDuplicates: true }
            );

            setStatus('saved');
            setTimeout(() => {
                setResult(null);
                setEdited(null);
                setFile(null);
                setUrl('');
                setStatus('idle');
            }, 2000);
        } catch (err: any) {
            setErrorMsg(err?.message || 'Error al guardar en el catálogo.');
            setStatus('error');
        }
    }, [edited]);

    // ── Reset ────────────────────────────────────────────────────────────────

    function handleReset() {
        setResult(null);
        setEdited(null);
        setFile(null);
        setUrl('');
        setErrorMsg('');
        setStatus('idle');
    }

    // ── Render ───────────────────────────────────────────────────────────────

    const isProcessing = status === 'processing';
    const isSaving     = status === 'saving';
    const isSaved      = status === 'saved';

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
                            onClick={() => setInputMode('file')}
                            className={cn(
                                'px-4 py-2 rounded-xl text-sm font-semibold border transition-colors',
                                inputMode === 'file'
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                            )}
                        >
                            📄 Subir archivo
                        </button>
                        <button
                            onClick={() => setInputMode('url')}
                            className={cn(
                                'px-4 py-2 rounded-xl text-sm font-semibold border transition-colors',
                                inputMode === 'url'
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                            )}
                        >
                            🔗 URL de documento
                        </button>
                    </div>

                    {/* Zona de entrada */}
                    {inputMode === 'file' ? (
                        <label className="relative bg-white border-2 border-dashed border-slate-200 rounded-3xl p-16 flex flex-col items-center justify-center text-center gap-6 hover:border-indigo-500 transition-all cursor-pointer group block">
                            <input
                                type="file"
                                accept=".pdf,.png,.jpg,.jpeg,.webp"
                                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                                onChange={(e) => e.target.files && setFile(e.target.files[0])}
                            />
                            <div className="w-20 h-20 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors pointer-events-none">
                                <Upload className="w-10 h-10" />
                            </div>
                            <div className="pointer-events-none">
                                <p className="font-bold text-xl">{file ? file.name : 'Suelta tu PDF o imagen aquí'}</p>
                                <p className="text-slate-400 max-w-xs mx-auto text-sm mt-1">PDF, PNG, JPEG, WEBP — máx. 10 MB</p>
                                {file && (
                                    <p className="text-indigo-600 text-sm mt-1 font-semibold">
                                        {(file.size / 1e6).toFixed(2)} MB · {file.type}
                                    </p>
                                )}
                            </div>
                        </label>
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
                    {(file || url.trim()) && (
                        <button
                            onClick={handleProcess}
                            disabled={isProcessing}
                            className="w-full py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-3 shadow-lg shadow-indigo-100 disabled:opacity-60 text-lg"
                        >
                            {isProcessing
                                ? <><Loader2 className="w-5 h-5 animate-spin" /> La IA está procesando el documento…</>
                                : <><Sparkles className="w-5 h-5" /> Estructurar con IA</>
                            }
                        </button>
                    )}
                </>
            ) : (
                /* ── Panel de resultados ──────────────────────────────────── */
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Preview */}
                    <div className="bg-slate-50 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[400px] border border-slate-200 gap-4">
                        {file && file.type.startsWith('image/') ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={URL.createObjectURL(file)}
                                alt="Preview"
                                className="max-h-80 object-contain rounded-xl shadow"
                            />
                        ) : (
                            <div className="text-center text-slate-400">
                                <Camera className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                <p className="text-sm font-medium">{file?.name || url.split('/').pop()}</p>
                                <p className="text-xs text-slate-300 mt-1">Vista previa no disponible para PDF</p>
                            </div>
                        )}
                        {/* Badge confianza global */}
                        <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-full border border-slate-200 shadow-sm">
                            <span className="text-xs text-slate-500">Confianza global:</span>
                            <ConfidenceBadge value={result.confidence} />
                        </div>
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

                        {/* Sección: Identificación */}
                        <div className="space-y-3">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-1">Identificación</p>
                            <Field
                                label="SKU Detectado"
                                value={edited?.sku_detectado}
                                onChange={(v) => updateField('sku_detectado', v)}
                                mono
                            />
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

                        {/* Sección: Descripción y materiales */}
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
                            <button
                                onClick={handleReset}
                                className="px-5 py-3 bg-slate-50 text-slate-600 font-bold rounded-xl hover:bg-slate-100 transition-all"
                            >
                                Descartar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
