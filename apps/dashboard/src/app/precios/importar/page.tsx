"use client";

/**
 * /precios/importar — Wizard de importación de Excel de precios del proveedor
 *
 * Paso 1: Subir Excel + indicar proveedor
 * Paso 2: Mapear columnas — Modelo (oblig), Marca (oblig), Precio (oblig),
 *         Código Universal (opc), Moneda (opc), Tipo de costo
 * Paso 3: Revisar matches con score y confirmar/descartar
 */

import { useState, useCallback, useRef } from 'react';
import {
    Upload, ChevronRight, FileSpreadsheet, CheckCircle,
    AlertCircle, Loader2, Search, Package,
    Check, ArrowLeft,
} from 'lucide-react';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface PreviewData {
    importacion_id: string;
    nombre_archivo: string;
    proveedor: string;
    headers: string[];
    rows: string[][];
    total_rows: number;
    mapeo_previo: Record<string, string> | null;
    tipo_costo_previo: string | null;
}

interface Costo {
    id: string;
    articulo_sugerido_id: string | null;
    modelo_excel: string | null;
    marca_excel: string | null;
    tipo_costo: string;
    valor: number;
    moneda: string;
    puntaje_match: number | null;
    estado_match: string;
    articulo_sugerido: { articulo_id: string; nombre: string; marca: string; modelo: string } | null;
}

interface Stats {
    sin_match: number;
    sugerido: number;
    confirmado: number;
    descartado: number;
}

const TIPOS_COSTO = [
    { value: 'distribuidor',    label: 'Distribuidor' },
    { value: 'subdistribuidor', label: 'Subdistribuidor' },
    { value: 'lista',           label: 'Precio de Lista' },
    { value: 'mayoreo',         label: 'Mayoreo' },
    { value: 'otro',            label: 'Otro' },
];

// ── Utilidades ────────────────────────────────────────────────────────────────

function cn(...classes: (string | boolean | undefined | null)[]) {
    return classes.filter(Boolean).join(' ');
}

function scoreColor(score: number | null): string {
    if (score === null) return 'text-slate-400';
    if (score >= 90) return 'text-emerald-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-rose-500';
}

function scoreBg(score: number | null): string {
    if (score === null) return 'bg-slate-100 border-slate-200';
    if (score >= 90) return 'bg-emerald-50 border-emerald-200';
    if (score >= 60) return 'bg-yellow-50 border-yellow-200';
    return 'bg-rose-50 border-rose-200';
}

// ── StepIndicator ─────────────────────────────────────────────────────────────

function StepIndicator({ step, current }: { step: number; current: number }) {
    const done = current > step;
    const active = current === step;
    return (
        <div className={cn(
            'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all',
            done   ? 'bg-indigo-600 border-indigo-600 text-white' :
            active ? 'border-indigo-600 text-indigo-600 bg-white' :
                     'border-slate-300 text-slate-400 bg-white'
        )}>
            {done ? <Check className="w-4 h-4" /> : step}
        </div>
    );
}

// ── Paso 1: Subir archivo ─────────────────────────────────────────────────────

function PasoSubir({ onDone }: {
    onDone: (data: { id: string; proveedor: string; nombre: string }) => void;
}) {
    const [file, setFile]         = useState<File | null>(null);
    const [proveedor, setProveedor] = useState('');
    const [loading, setLoading]   = useState(false);
    const [error, setError]       = useState<string | null>(null);
    const [dragging, setDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    function handleFile(f: File) {
        const ext = f.name.split('.').pop()?.toLowerCase();
        if (!ext || !['xlsx', 'xls'].includes(ext)) { setError('Solo se aceptan archivos .xlsx o .xls'); return; }
        if (f.size > 10 * 1024 * 1024)              { setError('El archivo excede 10 MB'); return; }
        setFile(f); setError(null);
    }

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault(); setDragging(false);
        const f = e.dataTransfer.files[0]; if (f) handleFile(f);
    }, []);

    async function handleSubmit() {
        if (!file)            { setError('Selecciona un archivo'); return; }
        if (!proveedor.trim()) { setError('Escribe el nombre del proveedor'); return; }
        setLoading(true); setError(null);
        try {
            const fd = new FormData();
            fd.append('file', file);
            fd.append('proveedor', proveedor.trim());
            const res  = await fetch('/api/precios/importar', { method: 'POST', body: fd });
            const data = await res.json();
            if (!data.ok) throw new Error(data.error);
            onDone({ id: data.importacion_id, proveedor: data.proveedor, nombre: data.nombre_archivo });
        } catch (e: any) { setError(e.message); }
        finally           { setLoading(false); }
    }

    return (
        <div className="space-y-6">
            <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                    Proveedor <span className="text-rose-500">*</span>
                </label>
                <input id="proveedor-input" type="text" value={proveedor}
                    onChange={(e) => { setProveedor(e.target.value); setError(null); }}
                    placeholder="Ej: Samsung, LG, Distribuidora XYZ..."
                    className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white" />
            </div>

            <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                    Archivo Excel <span className="text-rose-500">*</span>
                </label>
                <div onDrop={handleDrop}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onClick={() => inputRef.current?.click()}
                    className={cn(
                        'border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all',
                        dragging ? 'border-indigo-400 bg-indigo-50' :
                        file     ? 'border-emerald-400 bg-emerald-50' :
                                   'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
                    )}>
                    <input ref={inputRef} id="file-input" type="file" accept=".xlsx,.xls" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                    {file ? (
                        <div className="flex flex-col items-center gap-2">
                            <FileSpreadsheet className="w-10 h-10 text-emerald-500" />
                            <p className="font-bold text-emerald-700">{file.name}</p>
                            <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-3">
                            <Upload className="w-10 h-10 text-slate-300" />
                            <p className="font-semibold text-slate-600">Arrastra tu Excel aquí</p>
                            <p className="text-xs text-slate-400">o haz clic para seleccionar • .xlsx, .xls • máx. 10 MB</p>
                        </div>
                    )}
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 bg-rose-50 text-rose-700 rounded-xl px-4 py-3 text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />{error}
                </div>
            )}

            <button id="btn-subir-excel" onClick={handleSubmit} disabled={loading || !file}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-sm">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {loading ? 'Subiendo...' : 'Subir y continuar'}
                {!loading && <ChevronRight className="w-4 h-4 ml-auto" />}
            </button>
        </div>
    );
}

// ── Paso 2: Mapear columnas ───────────────────────────────────────────────────

function PasoMapear({ importacionId, onDone, onBack }: {
    importacionId: string;
    onDone: (stats: { total: number; con_match: number }) => void;
    onBack: () => void;
}) {
    const [preview, setPreview]           = useState<PreviewData | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(true);
    const [errorPreview, setErrorPreview] = useState<string | null>(null);

    // Columnas mapeadas
    const [columnaModelo,  setColumnaModelo]  = useState('');
    const [columnaMarca,   setColumnaMarca]   = useState('');
    const [columnaPrecio,  setColumnaPrecio]  = useState('');
    const [columnaCodigo,  setColumnaCodigo]  = useState('');
    const [columnaMoneda,  setColumnaMoneda]  = useState('');
    const [tipoCosto,      setTipoCosto]      = useState('distribuidor');
    const [monedaDefault,  setMonedaDefault]  = useState('MXN');
    const [loadingMapear,  setLoadingMapear]  = useState(false);
    const [error, setError]                   = useState<string | null>(null);

    const didFetch = useRef(false);
    if (!didFetch.current) {
        didFetch.current = true;
        fetch(`/api/precios/importar/${importacionId}/preview`)
            .then((r) => r.json())
            .then((data) => {
                if (!data.ok) throw new Error(data.error);
                setPreview(data);
                if (data.mapeo_previo) {
                    setColumnaModelo(data.mapeo_previo.columna_modelo  || '');
                    setColumnaMarca (data.mapeo_previo.columna_marca   || '');
                    setColumnaPrecio(data.mapeo_previo.columna_precio  || '');
                    setColumnaCodigo(data.mapeo_previo.columna_codigo  || '');
                    setColumnaMoneda(data.mapeo_previo.columna_moneda  || '');
                    setTipoCosto(data.tipo_costo_previo || data.mapeo_previo.tipo_costo || 'distribuidor');
                }
            })
            .catch((e) => setErrorPreview(e.message))
            .finally(() => setLoadingPreview(false));
    }

    async function handleMapear() {
        if (!columnaModelo) { setError('Selecciona la columna de Modelo'); return; }
        if (!columnaMarca)  { setError('Selecciona la columna de Marca');  return; }
        if (!columnaPrecio) { setError('Selecciona la columna de Precio'); return; }
        setLoadingMapear(true); setError(null);
        try {
            const res = await fetch(`/api/precios/importar/${importacionId}/mapear`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    columna_modelo: columnaModelo,
                    columna_marca:  columnaMarca,
                    columna_precio: columnaPrecio,
                    columna_codigo: columnaCodigo || undefined,
                    columna_moneda: columnaMoneda || undefined,
                    tipo_costo:     tipoCosto,
                    moneda_default: monedaDefault,
                }),
            });
            const data = await res.json();
            if (!data.ok) throw new Error(data.error);
            onDone({ total: data.total_filas, con_match: data.filas_con_match });
        } catch (e: any) { setError(e.message); }
        finally           { setLoadingMapear(false); }
    }

    if (loadingPreview) return (
        <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
            <span className="ml-3 text-slate-500">Leyendo el archivo...</span>
        </div>
    );

    if (errorPreview || !preview) return (
        <div className="text-center py-16">
            <AlertCircle className="w-10 h-10 text-rose-400 mx-auto mb-3" />
            <p className="text-rose-600 font-semibold">{errorPreview}</p>
            <button onClick={onBack} className="mt-4 text-sm text-indigo-600 hover:underline flex items-center gap-1 mx-auto">
                <ArrowLeft className="w-3.5 h-3.5" /> Volver
            </button>
        </div>
    );

    const headers = preview.headers;

    // Roles visuales por columna seleccionada
    type ColInfo = { label: string; emoji: string; hCls: string; cCls: string };
    const colRole: Record<string, ColInfo> = {};
    if (columnaModelo) colRole[columnaModelo] = { label: 'Modelo', emoji: '🔑', hCls: 'bg-indigo-50 text-indigo-700',  cCls: 'bg-indigo-50/40 font-bold' };
    if (columnaMarca)  colRole[columnaMarca]  = { label: 'Marca',  emoji: '🏷️', hCls: 'bg-violet-50 text-violet-700',  cCls: 'bg-violet-50/40 font-bold' };
    if (columnaPrecio) colRole[columnaPrecio] = { label: 'Precio', emoji: '💲', hCls: 'bg-emerald-50 text-emerald-700', cCls: 'bg-emerald-50/40 text-emerald-700 font-bold' };
    if (columnaCodigo) colRole[columnaCodigo] = { label: 'Código', emoji: '🔢', hCls: 'bg-amber-50 text-amber-700',    cCls: 'bg-amber-50/40 font-bold' };
    if (columnaMoneda) colRole[columnaMoneda] = { label: 'Moneda', emoji: '🌐', hCls: 'bg-sky-50 text-sky-700',        cCls: 'bg-sky-50/40' };

    function ColSelect({ id, value, onChange, label, required = false, hint }: {
        id: string; value: string; onChange: (v: string) => void;
        label: string; required?: boolean; hint?: string;
    }) {
        return (
            <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                    {label}{' '}
                    {required
                        ? <span className="text-rose-500">*</span>
                        : <span className="text-slate-400 normal-case font-normal">(opcional)</span>}
                </label>
                <select id={id} value={value}
                    onChange={(e) => { onChange(e.target.value); setError(null); }}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-400 focus:outline-none bg-white">
                    <option value="">{required ? '-- Seleccionar --' : '-- Sin columna --'}</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
                {hint && <p className="text-[10px] text-slate-400 mt-1">{hint}</p>}
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Info del archivo */}
            <div className="bg-slate-50 rounded-xl p-4 flex items-center gap-3 border border-slate-200">
                <FileSpreadsheet className="w-8 h-8 text-emerald-500 shrink-0" />
                <div>
                    <p className="font-bold text-slate-800 text-sm">{preview.nombre_archivo}</p>
                    <p className="text-xs text-slate-500">{preview.total_rows} filas • Proveedor: {preview.proveedor}</p>
                </div>
                {preview.mapeo_previo && (
                    <span className="ml-auto text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full font-semibold whitespace-nowrap">
                        ↩ Mapeo previo cargado
                    </span>
                )}
            </div>

            {/* Leyenda de colores */}
            <div className="flex flex-wrap gap-2 text-xs">
                {[
                    { emoji: '🔑', label: 'Modelo', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
                    { emoji: '🏷️', label: 'Marca',  cls: 'bg-violet-50 text-violet-700 border-violet-200' },
                    { emoji: '💲', label: 'Precio', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                    { emoji: '🔢', label: 'Código universal', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
                ].map(l => (
                    <span key={l.label} className={cn('px-2 py-0.5 rounded border font-semibold', l.cls)}>
                        {l.emoji} {l.label}
                    </span>
                ))}
            </div>

            {/* Selectores de columnas */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ColSelect id="sel-columna-modelo" value={columnaModelo} onChange={setColumnaModelo}
                    label="Columna: Modelo" required
                    hint="Número de parte, referencia o código del proveedor" />

                <ColSelect id="sel-columna-marca" value={columnaMarca} onChange={setColumnaMarca}
                    label="Columna: Marca" required
                    hint="Fabricante. Se combina con Modelo para el matching fuzzy en Postgres." />

                <ColSelect id="sel-columna-precio" value={columnaPrecio} onChange={setColumnaPrecio}
                    label="Columna: Precio" required />

                <ColSelect id="sel-columna-codigo" value={columnaCodigo} onChange={setColumnaCodigo}
                    label="Columna: Código Universal"
                    hint="UPC / EAN / código de barras. Si hay match exacto → score 100 garantizado." />

                <ColSelect id="sel-columna-moneda" value={columnaMoneda} onChange={setColumnaMoneda}
                    label="Columna: Moneda" />

                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                        Moneda por default
                    </label>
                    <select id="sel-moneda-default" value={monedaDefault}
                        onChange={(e) => setMonedaDefault(e.target.value)}
                        className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-400 focus:outline-none bg-white">
                        <option value="MXN">MXN — Peso Mexicano</option>
                        <option value="USD">USD — Dólar Americano</option>
                    </select>
                </div>

                <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                        Tipo de Costo <span className="text-rose-500">*</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                        {TIPOS_COSTO.map((t) => (
                            <button key={t.value} id={`tipo-costo-${t.value}`}
                                onClick={() => setTipoCosto(t.value)}
                                className={cn(
                                    'px-4 py-2 rounded-xl text-sm font-semibold border transition-all',
                                    tipoCosto === t.value
                                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                        : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                                )}>
                                {t.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Preview de tabla — columnas activas resaltadas por color */}
            {preview.rows.length > 0 && (
                <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                        Vista previa (primeras {preview.rows.length} filas)
                    </p>
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50">
                                <tr>
                                    {headers.map((h) => {
                                        const r = colRole[h];
                                        return (
                                            <th key={h} className={cn(
                                                'px-3 py-2 text-left font-bold border-b border-slate-200 whitespace-nowrap',
                                                r ? r.hCls : 'text-slate-500'
                                            )}>
                                                {r ? `${r.emoji} ` : ''}{h}
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody>
                                {preview.rows.map((row, i) => (
                                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                                        {headers.map((h, j) => {
                                            const r = colRole[h];
                                            return (
                                                <td key={j} className={cn('px-3 py-2 font-mono', r ? r.cCls : 'text-slate-600')}>
                                                    {row[j] || '—'}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 bg-rose-50 text-rose-700 rounded-xl px-4 py-3 text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />{error}
                </div>
            )}

            {/* Info del algoritmo */}
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 text-xs text-indigo-700 space-y-1">
                <p className="font-bold">¿Cómo funciona el matching?</p>
                <p>1. Si hay <span className="font-semibold">Código Universal</span>: match exacto en catálogo → score 100.</p>
                <p>2. Sin código: <span className="font-semibold">Marca + Modelo</span> del Excel vs catálogo usando similitud de texto en Postgres (pg_trgm).</p>
            </div>

            <div className="flex gap-3">
                <button onClick={onBack}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-all">
                    <ArrowLeft className="w-4 h-4" /> Volver
                </button>
                <button id="btn-ejecutar-mapeo" onClick={handleMapear}
                    disabled={loadingMapear || !columnaModelo || !columnaMarca || !columnaPrecio}
                    className="flex-1 flex items-center justify-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-sm text-sm">
                    {loadingMapear ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    {loadingMapear ? 'Ejecutando matching en Postgres...' : 'Ejecutar Matching'}
                    {!loadingMapear && <ChevronRight className="w-4 h-4 ml-auto" />}
                </button>
            </div>
        </div>
    );
}

// ── Paso 3: Revisar matches ───────────────────────────────────────────────────

function PasoRevisar({ importacionId, onFinish, onBack }: {
    importacionId: string;
    statsInit: { total: number; con_match: number };
    onFinish: () => void;
    onBack: () => void;
}) {
    const [costos, setCostos]       = useState<Costo[]>([]);
    const [stats, setStats]         = useState<Stats>({ sin_match: 0, sugerido: 0, confirmado: 0, descartado: 0 });
    const [loading, setLoading]     = useState(true);
    const [error, setError]         = useState<string | null>(null);
    const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
    const [guardando, setGuardando] = useState(false);
    const [guardadoOk, setGuardadoOk] = useState(false);
    const didLoad = useRef(false);

    if (!didLoad.current) {
        didLoad.current = true;
        fetch(`/api/precios/importar/${importacionId}/costos`)
            .then((r) => r.json())
            .then((data) => {
                if (!data.ok) throw new Error(data.error);
                setCostos(data.costos || []);
                setStats(data.stats || stats);
                const presel = new Set<string>(
                    (data.costos as Costo[])
                        .filter((c) => c.estado_match === 'sugerido')
                        .map((c) => c.id)
                );
                setSeleccionados(presel);
            })
            .catch((e) => setError(e.message))
            .finally(() => setLoading(false));
    }

    function toggleSelect(id: string) {
        setSeleccionados((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    }

    async function handleConfirmar() {
        if (seleccionados.size === 0) { setError('Selecciona al menos un match'); return; }
        setGuardando(true); setError(null);
        try {
            const acciones = costos.map((c) => ({
                costo_id: c.id,
                accion: seleccionados.has(c.id) ? 'confirmar' : 'descartar',
            }));
            const res  = await fetch(`/api/precios/importar/${importacionId}/confirmar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ acciones }),
            });
            const data = await res.json();
            if (!data.ok && data.errores?.length > 0) {
                setError(`${data.errores.length} error(es). Confirmados: ${data.confirmados}, Descartados: ${data.descartados}`);
            } else {
                setGuardadoOk(true);
            }
        } catch (e: any) { setError(e.message); }
        finally           { setGuardando(false); }
    }

    if (guardadoOk) return (
        <div className="text-center py-16 space-y-4">
            <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                <CheckCircle className="w-10 h-10 text-emerald-500" />
            </div>
            <h3 className="text-xl font-bold text-slate-900">¡Importación completada!</h3>
            <p className="text-slate-500 text-sm">Los costos confirmados están listos para el cálculo de precios.</p>
            <button onClick={onFinish}
                className="px-6 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all text-sm">
                Nueva importación
            </button>
        </div>
    );

    return (
        <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { label: 'Con Match',   value: stats.sugerido,   color: 'text-indigo-600',  bg: 'bg-indigo-50' },
                    { label: 'Sin Match',   value: stats.sin_match,  color: 'text-slate-500',   bg: 'bg-slate-50' },
                    { label: 'Confirmados', value: stats.confirmado, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                    { label: 'Descartados', value: stats.descartado, color: 'text-rose-500',    bg: 'bg-rose-50' },
                ].map((s) => (
                    <div key={s.label} className={cn('rounded-xl p-4 border border-transparent', s.bg)}>
                        <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">{s.label}</p>
                        <p className={cn('text-2xl font-bold', s.color)}>{s.value}</p>
                    </div>
                ))}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-slate-600">
                    <span className="font-bold text-indigo-600">{seleccionados.size}</span> seleccionados para confirmar
                </span>
                <button onClick={() => setSeleccionados(new Set(costos.filter((c) => c.articulo_sugerido_id).map((c) => c.id)))}
                    className="text-xs text-indigo-600 hover:underline font-semibold">
                    Seleccionar con match
                </button>
                <button onClick={() => setSeleccionados(new Set())}
                    className="text-xs text-slate-400 hover:underline">
                    Limpiar
                </button>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                    <span className="ml-2 text-slate-400">Cargando matches...</span>
                </div>
            ) : costos.length === 0 ? (
                <div className="text-center py-12">
                    <Package className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                    <p className="text-slate-400 text-sm">No hay costos pendientes de revisión.</p>
                </div>
            ) : (
                <div className="rounded-2xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase w-10">✓</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Del Excel</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Artículo sugerido</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Score</th>
                                <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Costo</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Tipo</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {costos.map((c) => {
                                const sel = seleccionados.has(c.id);
                                return (
                                    <tr key={c.id}
                                        onClick={() => c.articulo_sugerido_id && toggleSelect(c.id)}
                                        className={cn(
                                            'transition-colors',
                                            c.articulo_sugerido_id ? 'cursor-pointer hover:bg-slate-50' : 'opacity-60',
                                            sel ? 'bg-indigo-50/60' : ''
                                        )}>
                                        <td className="px-4 py-3">
                                            {c.articulo_sugerido_id && (
                                                <div className={cn(
                                                    'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                                                    sel ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'
                                                )}>
                                                    {sel && <Check className="w-3 h-3 text-white" />}
                                                </div>
                                            )}
                                        </td>
                                        {/* Datos del Excel */}
                                        <td className="px-4 py-3">
                                            <p className="font-mono text-slate-700 text-xs">{c.marca_excel && <span className="text-violet-600">{c.marca_excel} </span>}{c.modelo_excel}</p>
                                        </td>
                                        {/* Artículo sugerido */}
                                        <td className="px-4 py-3">
                                            {c.articulo_sugerido ? (
                                                <div>
                                                    <p className="font-semibold text-slate-800 text-xs leading-tight">{c.articulo_sugerido.nombre}</p>
                                                    <p className="text-[10px] text-slate-400 font-mono">
                                                        {c.articulo_sugerido.marca} · {c.articulo_sugerido.modelo}
                                                    </p>
                                                </div>
                                            ) : (
                                                <span className="text-slate-400 italic text-xs">Sin match</span>
                                            )}
                                        </td>
                                        {/* Score */}
                                        <td className="px-4 py-3">
                                            {c.puntaje_match != null ? (
                                                <span className={cn('px-2 py-1 rounded-lg text-xs font-bold border', scoreBg(c.puntaje_match), scoreColor(c.puntaje_match))}>
                                                    {c.puntaje_match}%
                                                </span>
                                            ) : <span className="text-slate-300 text-xs">—</span>}
                                        </td>
                                        {/* Costo */}
                                        <td className="px-4 py-3 text-right font-bold font-mono text-slate-800 text-xs">
                                            {new Intl.NumberFormat('es-MX', { style: 'currency', currency: c.moneda || 'MXN' }).format(c.valor)}
                                        </td>
                                        {/* Tipo */}
                                        <td className="px-4 py-3">
                                            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full font-semibold">
                                                {c.tipo_costo}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 bg-rose-50 text-rose-700 rounded-xl px-4 py-3 text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />{error}
                </div>
            )}

            <div className="flex gap-3">
                <button onClick={onBack}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-all">
                    <ArrowLeft className="w-4 h-4" /> Volver
                </button>
                <button id="btn-confirmar-matches" onClick={handleConfirmar}
                    disabled={guardando || seleccionados.size === 0}
                    className="flex-1 flex items-center justify-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-sm text-sm">
                    {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                    {guardando ? 'Confirmando...' : `Confirmar ${seleccionados.size} match${seleccionados.size !== 1 ? 'es' : ''}`}
                </button>
            </div>
        </div>
    );
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function ImportarPreciosPage() {
    const [step, setStep]               = useState<1 | 2 | 3>(1);
    const [importacionId, setImportacionId] = useState<string | null>(null);
    const [matchStats, setMatchStats]   = useState<{ total: number; con_match: number } | null>(null);

    const PASOS = ['Subir Excel', 'Mapear Columnas', 'Revisar Matches'];

    function reset() { setStep(1); setImportacionId(null); setMatchStats(null); }

    return (
        <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-sm">
                        <FileSpreadsheet className="w-5 h-5 text-white" />
                    </div>
                    Importar Precios del Proveedor
                </h1>
                <p className="text-slate-500 text-sm mt-1">
                    Sube un Excel de precios, mapea las columnas y valida los matches con tu catálogo.
                </p>
            </div>

            {/* Wizard card */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                {/* Stepper */}
                <div className="flex items-center mb-8">
                    {PASOS.map((nombre, i) => (
                        <div key={i} className="flex items-center flex-1 last:flex-none">
                            <div className="flex flex-col items-center gap-1">
                                <StepIndicator step={i + 1} current={step} />
                                <span className={cn(
                                    'text-xs font-semibold whitespace-nowrap hidden sm:block',
                                    step === i + 1   ? 'text-indigo-600'  :
                                    step > i + 1     ? 'text-emerald-600' : 'text-slate-400'
                                )}>
                                    {nombre}
                                </span>
                            </div>
                            {i < PASOS.length - 1 && (
                                <div className={cn(
                                    'flex-1 h-0.5 mx-3 mt-[-12px] rounded-full transition-all duration-500',
                                    step > i + 1 ? 'bg-indigo-400' : 'bg-slate-200'
                                )} />
                            )}
                        </div>
                    ))}
                </div>

                {/* Contenido por paso */}
                {step === 1 && (
                    <PasoSubir onDone={({ id }) => { setImportacionId(id); setStep(2); }} />
                )}
                {step === 2 && importacionId && (
                    <PasoMapear
                        importacionId={importacionId}
                        onBack={() => setStep(1)}
                        onDone={(stats) => { setMatchStats(stats); setStep(3); }}
                    />
                )}
                {step === 3 && importacionId && matchStats && (
                    <PasoRevisar
                        importacionId={importacionId}
                        statsInit={matchStats}
                        onBack={() => setStep(2)}
                        onFinish={reset}
                    />
                )}
            </div>
        </div>
    );
}
