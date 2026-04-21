"use client";
/**
 * /precios/importar — Wizard de importación de Excel de precios del proveedor
 *
 * Paso 1: Subir Excel + indicar proveedor
 * Paso 2: Mapear columnas:
 *   - Modelo (oblig) + Marca (oblig) → fuzzy matching via pg_trgm
 *   - Código Universal (opc) + Marca + Modelo → match exacto score 100
 *   - Descripción (opc) → para comparación visual
 *   - Uno o MÚLTIPLES tipos de precio ({columna, tipo_costo})
 *   - Moneda por columna o default
 * Paso 3: Revisar matches con score y confirmar/descartar
 */
import { useState, useRef, useCallback, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Upload, ChevronRight, FileSpreadsheet, CheckCircle,
  AlertCircle, Loader2, Search, Package, Check, ArrowLeft,
  Plus, Trash2, X, Shuffle, MoreHorizontal, MousePointerClick, CheckSquare, Zap, Target
} from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { TablaComparacion } from './TablaComparacion';
import { Costo, Stats, GrupoCostoFila, EstadoMatch, Candidato, clasificarEstado } from './types';
import { BannerImportacionActiva } from './BannerImportacionActiva';

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface PreviewData {
  importacion_id: string;
  nombre_archivo: string;
  proveedor: string;
  headers: string[];
  rows: string[][];
  total_rows: number;
  mapeo_previo: Record<string, any> | null;
  tipo_costo_previo: string | null;
}


interface PrecioMapeo { columna: string; tipo_costo: string; incluye_iva?: boolean; }

const TIPOS_COSTO = [
  { value: 'distribuidor', label: 'Distribuidor' },
  { value: 'subdistribuidor', label: 'Subdistribuidor' },
  { value: 'menudeo', label: 'Precio de Menudeo' },
  { value: 'mayoreo', label: 'Mayoreo' },
  { value: 'otro', label: 'Otro' },
];

// ── Utilidades ────────────────────────────────────────────────────────────────
function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(' ');
}

function scoreColor(s: number | null) {
  if (s === null) return 'text-slate-400';
  if (s >= 90) return 'text-emerald-600';
  if (s >= 60) return 'text-yellow-600';
  return 'text-rose-500';
}

function scoreBg(s: number | null) {
  if (s === null) return 'bg-slate-100 border-slate-200';
  if (s >= 90) return 'bg-emerald-50 border-emerald-200';
  if (s >= 60) return 'bg-yellow-50 border-yellow-200';
  return 'bg-rose-50 border-rose-200';
}

// ── StepIndicator ─────────────────────────────────────────────────────────────
function StepIndicator({ step, current }: { step: number; current: number }) {
  const done = current > step;
  const active = current === step;
  return (
    <div className={cn(
      'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all',
      done ? 'bg-emerald-500 text-white' : active ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-200 text-slate-500'
    )}>
      {done ? <Check className="w-4 h-4" /> : step}
    </div>
  );
}

// ── Paso 1 ──────────────────────────────────────────────────────────────────
function PasoSubir({ onDone }: { onDone: (d: { id: string; proveedor: string; nombre: string }) => void }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [proveedor, setProveedor] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [activa, setActiva] = useState<null | { id: string; estado: string; nombre_archivo: string | null; creado_el: string }>(null);
  const [checkingActiva, setCheckingActiva] = useState(false);

  useEffect(() => {
    const p = proveedor.trim();
    if (!p) { setActiva(null); return; }
    setCheckingActiva(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/precios/importar/activa?proveedor=${encodeURIComponent(p)}`);
        const j = await r.json();
        setActiva(j?.ok && j?.data ? j.data : null);
      } finally { setCheckingActiva(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [proveedor]);

  function handleFile(f: File) {
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls'].includes(ext ?? '')) { setError('Solo .xlsx o .xls'); return; }
    if (f.size > 10 * 1024 * 1024) { setError('Máximo 10 MB'); return; }
    setFile(f); setError(null);
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0]; if (f) handleFile(f);
  }, []);

  async function submit() {
    if (!file) { setError('Selecciona un archivo'); return; }
    if (!proveedor.trim()) { setError('Escribe el proveedor'); return; }
    setLoading(true); setError(null);
    try {
      // 1) Pedir signed URL
      const r1 = await fetch('/api/precios/importar/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proveedor: proveedor.trim(), fileName: file.name }),
      });
      const j1 = r1.ok ? await r1.json() : { ok: false, error: await r1.text() };
      if (!j1.ok) throw new Error(j1.error);

      // 2) Upload directo a Storage (cliente → Supabase)
      const supabase = supabaseBrowser();
      const { error: upErr } = await supabase.storage
        .from(j1.bucket)
        .uploadToSignedUrl(j1.path, j1.token, file);
      if (upErr) throw new Error(upErr.message);

      // 3) Registrar en BD
      const r3 = await fetch('/api/precios/importar/registrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proveedor: proveedor.trim(), fileName: file.name, storagePath: j1.path, bucket: j1.bucket }),
      });
      if (r3.status === 409) {
         const j3 = await r3.json().catch(() => null);
         if (j3?.importacion_activa) setActiva(j3.importacion_activa);
         setError('Ya existe una importación activa para este proveedor.');
         setLoading(false);
         return;
      }
      const j3 = r3.ok ? await r3.json() : { ok: false, error: await r3.text() };
      if (!j3.ok) throw new Error(j3.error);

      onDone({ id: j3.importacion_id, proveedor: proveedor.trim(), nombre: file.name });
    } catch (e: any) { 
      setError(e.message || 'Error al procesar la importación'); 
    } finally { 
      setLoading(false); 
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="proveedor-input" className="block text-xs font-bold text-slate-600 mb-1">Proveedor <span className="text-rose-500">*</span></label>
        <input id="proveedor-input" type="text" value={proveedor}
          onChange={(e) => { setProveedor(e.target.value); setError(null); }}
          placeholder="Ej: Samsung, LG, Urrea..."
          className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white" />
      </div>
      <div>
        <label className="block text-xs font-bold text-slate-600 mb-1">Archivo Excel <span className="text-rose-500">*</span></label>
        <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
          onDrop={handleDrop} onClick={() => inputRef.current?.click()}
          className={cn('border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all',
            dragging ? 'border-indigo-400 bg-indigo-50' : file ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50')}>
          <input ref={inputRef} id="file-input" type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          {file ? (
            <div className="flex items-center justify-center gap-3">
              <FileSpreadsheet className="w-8 h-8 text-emerald-600" />
              <div className="text-left"><p className="font-bold text-sm">{file.name}</p><p className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</p></div>
            </div>
          ) : (
            <div><Upload className="mx-auto w-10 h-10 text-slate-300 mb-2" /><p className="text-sm font-semibold text-slate-500">Arrastra tu Excel aquí</p><p className="text-xs text-slate-400 mt-1">o haz clic • .xlsx, .xls • máx. 10 MB</p></div>
          )}
        </div>
      </div>
      {error && <div className="flex items-center gap-2 text-rose-600 text-sm bg-rose-50 px-4 py-2 rounded-xl"><AlertCircle className="w-4 h-4" />{error}</div>}
      
      {activa && (
        <BannerImportacionActiva
          activa={activa}
          onContinuar={(id) => router.push(`/precios/importar?id=${id}`)}
          onCancelar={async () => {
             const r = await fetch('/api/precios/importar/cancelar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: activa.id }),
             });
             const j = await r.json();
             if (!r.ok || !j?.ok) throw new Error(j?.error ?? 'No se pudo cancelar');
             setActiva(null);
          }}
        />
      )}

      <button onClick={submit} disabled={loading || !!activa || checkingActiva} className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-sm">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {loading ? 'Subiendo...' : activa ? 'Hay una importación en curso' : 'Subir y continuar'}
        {!loading && !activa && <ChevronRight className="w-4 h-4" />}
      </button>
    </div>
  );
}

// ── Paso 2 ──────────────────────────────────────────────────────────────────
function PasoMapear({ importacionId, onDone, onBack }: {
  importacionId: string;
  onDone: (stats: { total: number; con_match: number }) => void;
  onBack: () => void;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [errorPreview, setErrorPreview] = useState<string | null>(null);
  const [columnaModelo, setColumnaModelo] = useState('');
  const [columnaMarca, setColumnaMarca] = useState('');
  const [columnaCodigo, setColumnaCodigo] = useState('');
  const [columnaDescripcion, setColumnaDescripcion] = useState('');
  const [columnaMoneda, setColumnaMoneda] = useState('');
  const [monedaDefault, setMonedaDefault] = useState('MXN');
  const [columnasAGuardar, setColumnasAGuardar] = useState<string[]>([]);
  const [precios, setPrecios] = useState<PrecioMapeo[]>([{ columna: '', tipo_costo: 'distribuidor' }]);
  const [loadingMapear, setLoadingMapear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const didFetch = useRef(false);

  if (!didFetch.current) {
    didFetch.current = true;
    fetch(`/api/precios/importar/${importacionId}/preview`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error);
        setPreview(d);
        const m = d.mapeo_previo;
        if (m) {
          setColumnaModelo(m.columna_modelo || '');
          setColumnaMarca(m.columna_marca || '');
          setColumnaCodigo(m.columna_codigo || '');
          setColumnaDescripcion(m.columna_descripcion || '');
          setColumnaMoneda(m.columna_moneda || '');
          if (Array.isArray(m.precios) && m.precios.length > 0) {
            setPrecios(m.precios);
          } else if (m.columna_precio && m.tipo_costo) {
            setPrecios([{ columna: m.columna_precio, tipo_costo: m.tipo_costo, incluye_iva: false }]);
          }
        }
        
        // Inicializar columnas a guardar con todos los headers por defecto
        setColumnasAGuardar(d.headers || []);
      })
      .catch((e) => setErrorPreview(e.message))
      .finally(() => setLoadingPreview(false));
  }

  function addPrecio() { setPrecios((p) => [...p, { columna: '', tipo_costo: 'menudeo', incluye_iva: false }]); }
  function removePrecio(i: number) { setPrecios((p) => p.filter((_, j) => j !== i)); }
  function updatePrecio(i: number, field: keyof PrecioMapeo, val: any) {
    setPrecios((p) => p.map((item, j) => j === i ? { ...item, [field]: val } : item));
  }

  async function handleMapear() {
    if (!columnaModelo) { setError('Selecciona la columna de Modelo'); return; }
    if (!columnaMarca) { setError('Selecciona la columna de Marca'); return; }
    const preciosValidos = precios.filter((p) => p.columna && p.tipo_costo);
    if (preciosValidos.length === 0) { setError('Agrega al menos un tipo de precio con columna seleccionada'); return; }
    setLoadingMapear(true); setError(null);
    try {
      const res = await fetch(`/api/precios/importar/${importacionId}/mapear`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          columna_modelo: columnaModelo,
          columna_marca: columnaMarca,
          precios: preciosValidos,
          columna_codigo: columnaCodigo || undefined,
          columna_descripcion: columnaDescripcion || undefined,
          columna_moneda: columnaMoneda || undefined,
          moneda_default: monedaDefault,
          columnasAGuardar,
        }),
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error);
      router.push(`/precios/importaciones/${importacionId}`);
    } catch (e: any) { setError(e.message); } finally { setLoadingMapear(false); }
  }

  if (loadingPreview) return (
    <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
      <Loader2 className="w-5 h-5 animate-spin" /> Leyendo el archivo...
    </div>
  );
  if (errorPreview || !preview) return (
    <div className="text-center py-16">
      <p className="text-rose-600 mb-4">{errorPreview}</p>
      <button onClick={onBack} className="text-indigo-600 hover:underline">Volver</button>
    </div>
  );

  const headers = preview.headers;

  // Colores por rol para el preview
  type ColInfo = { label: string; emoji: string; hCls: string; cCls: string };
  const colRole: Record<string, ColInfo> = {};
  if (columnaModelo) colRole[columnaModelo] = { label: 'Modelo', emoji: '🔑', hCls: 'bg-indigo-50 text-indigo-700', cCls: 'bg-indigo-50/40 font-bold' };
  if (columnaMarca) colRole[columnaMarca] = { label: 'Marca', emoji: '🏷️', hCls: 'bg-violet-50 text-violet-700', cCls: 'bg-violet-50/40 font-bold' };
  if (columnaCodigo) colRole[columnaCodigo] = { label: 'Código', emoji: '🔢', hCls: 'bg-amber-50 text-amber-700', cCls: 'bg-amber-50/40 font-bold' };
  if (columnaDescripcion) colRole[columnaDescripcion] = { label: 'Descripción', emoji: '📝', hCls: 'bg-teal-50 text-teal-700', cCls: 'bg-teal-50/40' };
  if (columnaMoneda) colRole[columnaMoneda] = { label: 'Moneda', emoji: '🌐', hCls: 'bg-sky-50 text-sky-700', cCls: 'bg-sky-50/40' };
  precios.forEach((p) => {
    if (p.columna) colRole[p.columna] = { label: TIPOS_COSTO.find((t) => t.value === p.tipo_costo)?.label ?? p.tipo_costo, emoji: '💲', hCls: 'bg-emerald-50 text-emerald-700', cCls: 'bg-emerald-50/40 text-emerald-700 font-bold' };
  });

  function Sel({ id, value, onChange, placeholder = '-- Seleccionar --' }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
    return (
      <select id={id} value={value} onChange={(e) => { onChange(e.target.value); setError(null); }}
        className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-400 focus:outline-none bg-white">
        <option value="">{placeholder}</option>
        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    );
  }

  return (
    <div className="space-y-6">
      {/* Info archivo */}
      <div className="flex items-center gap-3">
        <FileSpreadsheet className="w-5 h-5 text-indigo-500" />
        <div>
          <p className="font-bold text-sm">{preview.nombre_archivo}</p>
          <p className="text-xs text-slate-400">{preview.total_rows} filas • Proveedor: {preview.proveedor}</p>
        </div>
        {preview.mapeo_previo && (<span className="ml-auto text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded-full font-semibold"> ↩ Mapeo previo </span>)}
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap gap-2">
        {[
          { emoji: '🔑', label: 'Modelo', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
          { emoji: '🏷️', label: 'Marca', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
          { emoji: '💲', label: 'Precio', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
          { emoji: '🔢', label: 'Código', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
          { emoji: '📝', label: 'Descripción', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
        ].map(l => <span key={l.label} className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${l.cls}`}>{l.emoji} {l.label}</span>)}
      </div>

      {/* Identificación del producto */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-slate-700">Identificación del producto</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Modelo <span className="text-rose-500">*</span></label>
            <Sel id="sel-columna-modelo" value={columnaModelo} onChange={setColumnaModelo} />
            <p className="text-[10px] text-slate-400 mt-1">Referencia, N° de parte del proveedor</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Marca <span className="text-rose-500">*</span></label>
            <Sel id="sel-columna-marca" value={columnaMarca} onChange={setColumnaMarca} />
            <p className="text-[10px] text-slate-400 mt-1">Se combina con Modelo para matching</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Código Universal <span className="text-slate-400">(opc.)</span></label>
            <Sel id="sel-columna-codigo" value={columnaCodigo} onChange={setColumnaCodigo} placeholder="-- Sin columna --" />
            <p className="text-[10px] text-slate-400 mt-1">UPC/EAN → match exacto score 100</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Descripción <span className="text-slate-400">(opc.)</span></label>
            <Sel id="sel-columna-descripcion" value={columnaDescripcion} onChange={setColumnaDescripcion} placeholder="-- Sin columna --" />
            <p className="text-[10px] text-slate-400 mt-1">Título o descripción larga del producto</p>
          </div>
        </div>
      </div>

      {/* RAW: Columnas originales a conservar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
         <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700">Columnas originales a conservar (Raw)</h3>
            <div className="flex gap-2">
               <button onClick={() => setColumnasAGuardar(headers)} className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-2 py-1 rounded">Marcar todas</button>
               <button onClick={() => setColumnasAGuardar([])} className="text-[10px] text-slate-500 font-bold bg-slate-100 px-2 py-1 rounded">Desmarcar todas</button>
            </div>
         </div>
         <p className="text-xs text-slate-500 leading-relaxed mb-3">
           Elige qué columnas deseas guardar como evidencia o base de datos. Se almacenarán permanentemente en el payload original, sin modificar, incluso si no son requeridas para la validación (identidad de la fila).
         </p>
         <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
           {headers.map((h) => {
             const isChecked = columnasAGuardar.includes(h);
             return (
               <label key={h} className={cn("flex items-center gap-2 p-2 text-xs border rounded-lg cursor-pointer transition-colors", isChecked ? "border-indigo-400 bg-indigo-50/30" : "border-slate-200 bg-slate-50 opacity-75")}>
                 <input type="checkbox" checked={isChecked} onChange={(e) => {
                   if(e.target.checked) setColumnasAGuardar(p => [...p, h]);
                   else setColumnasAGuardar(p => p.filter(x => x !== h));
                 }} className="rounded uppercase no-outline w-3 h-3 text-indigo-600"/>
                 <span className="truncate font-medium">{h}</span>
               </label>
             );
           })}
         </div>
      </div>

      {/* Tipos de precio — múltiples */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-700">Tipos de precio <span className="text-rose-500">*</span></h3>
          <button onClick={addPrecio} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-semibold border border-indigo-200 rounded-lg px-2 py-1">
            <Plus className="w-3.5 h-3.5" /> Agregar tipo
          </button>
        </div>
        {precios.map((p, i) => (
          <div key={i} className="flex items-start gap-3 flex-wrap">
            <div className="flex-[2] min-w-32"><Sel id={`sel-precio-col-${i}`} value={p.columna} onChange={(v) => updatePrecio(i, 'columna', v)} /></div>
            <div className="flex-[2] min-w-32">
              <select id={`sel-precio-tipo-${i}`} value={p.tipo_costo}
                onChange={(e) => updatePrecio(i, 'tipo_costo', e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-400 focus:outline-none bg-white">
                {TIPOS_COSTO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-24 flex items-center pt-2">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-600">
                <input type="checkbox" checked={p.incluye_iva || false} onChange={(e) => updatePrecio(i, 'incluye_iva', e.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4" />
                ¿Con IVA?
              </label>
            </div>
            {precios.length > 1 && (
              <button onClick={() => removePrecio(i)} className="mt-1 p-2 text-slate-300 hover:text-rose-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
            )}
          </div>
        ))}
        {precios.length > 1 && (
          <p className="text-xs text-slate-400 mt-2">
            {precios.length} tipos de precio → se insertan {precios.length} registros por fila del Excel
          </p>
        )}
      </div>

      {/* Moneda */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Columna: Moneda <span className="text-slate-400">(opc.)</span></label>
            <Sel id="sel-columna-moneda" value={columnaMoneda} onChange={setColumnaMoneda} placeholder="-- Sin columna --" />
          </div>
          <div>
            <label htmlFor="sel-moneda-default" className="block text-xs font-bold text-slate-600 mb-1">Moneda por default</label>
            <select id="sel-moneda-default" value={monedaDefault} onChange={(e) => setMonedaDefault(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-400 focus:outline-none bg-white">
              <option value="MXN">MXN — Peso Mexicano</option>
              <option value="USD">USD — Dólar Americano</option>
            </select>
          </div>
        </div>
      </div>

      {/* Preview de tabla */}
      {preview.rows.length > 0 && (
        <div className="border border-slate-200 rounded-2xl overflow-hidden">
          <p className="text-xs font-bold text-slate-500 px-4 py-2 bg-slate-50">Vista previa (primeras {preview.rows.length} filas)</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-slate-200">
                {headers.map((h) => {
                  const r = colRole[h];
                  return <th key={h} className={cn('px-3 py-2 text-left font-bold whitespace-nowrap', r?.hCls)}>{r ? `${r.emoji} ` : ''}{h}</th>;
                })}
              </tr></thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    {headers.map((h, j) => {
                      const r = colRole[h];
                      return <td key={j} className={cn('px-3 py-1.5 whitespace-nowrap', r?.cCls)}>{row[j] || '—'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && (<div className="flex items-center gap-2 text-rose-600 text-sm bg-rose-50 px-4 py-2 rounded-xl"><AlertCircle className="w-4 h-4" />{error}</div>)}

      {/* Info matching */}
      <div className="text-xs text-slate-400 space-y-1 bg-slate-50 rounded-xl p-4">
        <p className="font-bold text-slate-500">Algoritmo de matching (en Postgres)</p>
        <p>1. <strong>Código Universal</strong> → match exacto contra catálogo → score 100.</p>
        <p>2. <strong>Marca + Modelo</strong> del Excel vs catálogo con similitud de texto (pg_trgm, índice GIN).</p>
      </div>

      <div className="flex gap-3">
        <button onClick={onBack} className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-sm font-semibold">
          <ArrowLeft className="w-3.5 h-3.5" /> Volver
        </button>
        <button onClick={handleMapear} disabled={loadingMapear || !columnaModelo || !columnaMarca || precios.every((p) => !p.columna)}
          className="flex-1 flex items-center justify-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-sm text-sm">
          {loadingMapear ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {loadingMapear ? 'Ejecutando matching...' : 'Ejecutar Matching'}
          {!loadingMapear && <ChevronRight className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

// ── RemapModal (Ticket 2) ────────────────────────────────────────────────────
interface ArticuloBusqueda {
  articulo_id: string;
  nombre: string;
  modelo: string;
  marca: string;
  codigo_universal: string | null;
}

function RemapModal({ costoId, onSelect, onClose }: {
  costoId: string;
  onSelect: (articulo: ArticuloBusqueda) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState<ArticuloBusqueda[]>([]);
  const [buscando, setBuscando] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleQuery(q: string) {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setResultados([]); return; }
    debounceRef.current = setTimeout(async () => {
      setBuscando(true);
      try {
        const res = await fetch(`/api/articulos/buscar?query=${encodeURIComponent(q)}&limit=20`);
        const d = await res.json();
        setResultados(d.items || []);
      } catch { setResultados([]); }
      finally { setBuscando(false); }
    }, 300);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-800">Remapear artículo</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        {/* Search */}
        <div className="px-5 py-3 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              id="remap-search-input"
              autoFocus
              type="text"
              value={query}
              onChange={(e) => handleQuery(e.target.value)}
              placeholder="Buscar por modelo, marca, código universal..."
              className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            {buscando && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-slate-400" />}
          </div>
        </div>
        {/* Results */}
        <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
          {resultados.length === 0 && query.trim() && !buscando && (
            <p className="text-center text-slate-400 text-sm py-8">Sin resultados para "{query}"</p>
          )}
          {resultados.length === 0 && !query.trim() && (
            <p className="text-center text-slate-300 text-sm py-8">Escribe para buscar en el catálogo</p>
          )}
          {resultados.map((art) => (
            <div key={art.articulo_id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors">
              <div className="min-w-0">
                <p className="font-semibold text-sm text-slate-800 truncate">{art.nombre}</p>
                <p className="text-xs text-slate-400 font-mono">
                  <span className="text-violet-600 font-bold">{art.marca}</span> · {art.modelo}
                  {art.codigo_universal && <span className="ml-2 text-amber-600">{art.codigo_universal}</span>}
                </p>
              </div>
              <button
                onClick={() => onSelect(art)}
                className="ml-3 shrink-0 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors">
                Seleccionar
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Paso 3 ──────────────────────────────────────────────────────────────────
function PasoRevisar({ importacionId, onFinish, onBack }: {
  importacionId: string;
  statsInit: { total: number; con_match: number };
  onFinish: () => void;
  onBack: () => void;
}) {
  const [grupos, setGrupos] = useState<GrupoCostoFila[]>([]);
  const [stats, setStats] = useState<Stats>({ sin_match: 0, sugerido: 0, confirmado: 0, rechazado: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [erroresDetalle, setErroresDetalle] = useState<{ costo_id: string; error: string }[]>([]);
  const [erroresVisible, setErroresVisible] = useState(false);
  const [remapGrupoCostoId, setRemapGrupoCostoId] = useState<string | null>(null);
  const [remaps, setRemaps] = useState<Record<string, { articulo_id: string; nombre: string; marca: string; modelo: string }>>({});
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState(false);
  const [filtroVista, setFiltroVista] = useState<'todos' | 'con_match' | 'sin_match' | 'duda'>('todos');
  const [batchIdConfirmado, setBatchIdConfirmado] = useState<string | null>(null);
  const [revertiendo, setRevertiendo] = useState(false);
  
  // Nuevo estado para la decisión del usuario (grupo.clave -> articulo_id | null)
  // null = 'Sin asignar' (saltar fila)
  const [selecciones, setSelecciones] = useState<Record<string, string | null>>({});

  const didLoad = useRef(false);

  if (!didLoad.current) {
    didLoad.current = true;
    fetch(`/api/precios/importar/${importacionId}/costos`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error);
        const fetchedGrupos = d.grupos || [];
        setGrupos(fetchedGrupos);
        setStats(d.stats || stats);
        
        // Ninguna fila se auto-asigna. Regla de oro: todo requiere validación humana.
        const initialSels: Record<string, string | null> = {};
        fetchedGrupos.forEach((g: any) => {
           initialSels[g.clave] = null;
        });
        setSelecciones(initialSels);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  async function refrescarCostos() {
    try {
      const res = await fetch(`/api/precios/importar/${importacionId}/costos`);
      const d = await res.json();
      if (d.ok) {
        setGrupos(d.grupos || []);
        setStats(d.stats || stats);
      }
    } catch { /* silencioso */ }
  }

  function handleExportarNoAsignados() {
    const csvContent = "data:text/csv;charset=utf-8," 
        + "Modelo,Marca,Código,Costo,Moneda,Tipo\n"
        + grupos
            .filter(g => selecciones[g.clave] === null)
            .flatMap(g => {
                const arr = Object.values(g.precios_nuevos) as Array<{ costo_id: string; valor: number; moneda: string; tipo_costo: string } | null>;
                return arr.filter(Boolean).map(pn => `${g.excel.modelo},${g.excel.marca},${g.excel.codigo_universal || ''},${pn!.valor},${pn!.moneda},${pn!.tipo_costo}`);
            })
            .join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "filas_no_asignadas.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handleExportarSinMatchSistema() {
    const csvContent = "data:text/csv;charset=utf-8," 
        + "Modelo,Marca,Código,Costo,Moneda,Tipo\n"
        + grupos
            .filter(g => clasificarEstado(g.catalogo_sugerido?.puntaje_match ?? null) === 'sin_match')
            .flatMap(g => {
                const arr = Object.values(g.precios_nuevos) as Array<{ costo_id: string; valor: number; moneda: string; tipo_costo: string } | null>;
                return arr.filter(Boolean).map(pn => `${g.excel.modelo},${g.excel.marca},${g.excel.codigo_universal || ''},${pn!.valor},${pn!.moneda},${pn!.tipo_costo}`);
            })
            .join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "sin_match_sistema.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async function handleConfirmar() {
    const acciones: any[] = [];
    grupos.forEach(g => {
      const sid = selecciones[g.clave];
      if (sid) {
         const arr = Object.values(g.precios_nuevos) as Array<{ costo_id: string; valor: number; moneda: string; tipo_costo: string } | null>;
         arr.forEach(pn => {
            if (pn) {
                acciones.push({ costo_id: pn.costo_id, accion: 'confirmar', articulo_id_override: sid });
            }
         });
      }
    });

    if (acciones.length === 0) {
       setError('No hay grupos con candidatos asignados para enviar. Marca "Sin asignar" o mapea los requeridos.'); 
       return; 
    }

    // Dudas pendientes
    const dudasPendientes = grupos.some(g => clasificarEstado(g.catalogo_sugerido?.puntaje_match ?? null) === 'duda' && selecciones[g.clave] === null);
    if (dudasPendientes) {
        if (!confirm('Aún tienes filas ambiguas (Dudas) que marcaste como "Sin asignar". ¿Estás seguro de enviarlas sin registrar?')) return;
    }

    setGuardando(true); setError(null); setErroresDetalle([]); setErroresVisible(false);
    try {
      const res = await fetch(`/api/precios/importar/${importacionId}/confirmar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acciones }),
      });
      const d = await res.json();
      if (!d.ok && d.errores?.length > 0) {
        setErroresDetalle(d.errores);
        setError(`${d.errores.length} error(es). Confirmados: ${d.confirmados}, Descartados: ${d.descartados}.`);
        await refrescarCostos();
      } else if (d.confirmados > 0 && d.errores?.length === 0) {
        if (d.batch_id) setBatchIdConfirmado(d.batch_id);
        setGuardadoOk(true);
      } else {
        if (d.batch_id) setBatchIdConfirmado(d.batch_id);
        setGuardadoOk(true);
      }
    } catch (e: any) { setError(e.message); } finally { setGuardando(false); }
  }

  async function handleRevertirLote() {
    if (!batchIdConfirmado) return;
    if (!confirm('¿Estás seguro de que deseas revertir este lote de precios? Esta acción restaurará los valores antiguos y eliminará las inyecciones nuevas.')) return;
    
    setRevertiendo(true);
    try {
      const res = await fetch(`/api/precios/importar/batches/${batchIdConfirmado}/revert`, { method: 'DELETE' });
      const d = await res.json();
      if (!d.ok) {
        alert('Error al revertir: ' + d.error);
      } else {
        alert(`¡Lote revertido con éxito! Se restauraron ${d.revertidos} registros de precios.`);
        setBatchIdConfirmado(null);
        onFinish();
      }
    } catch (e: any) {
      alert('Error en llamada a Revert: ' + e.message);
    } finally {
      setRevertiendo(false);
    }
  }

  const numSeleccionados = Object.values(selecciones).filter(Boolean).length;

  function gruposFiltrados() {
     return grupos.filter(g => {
        const pMatch = g.catalogo_sugerido?.puntaje_match;
        if (filtroVista === 'con_match') return pMatch === 100;
        if (filtroVista === 'sin_match') return !pMatch;
        if (filtroVista === 'duda') return pMatch && pMatch < 100 && pMatch >= 40;
        return true;
     });
  }

  if (guardadoOk) return (
    <div className="text-center py-16">
      <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
      <h3 className="text-xl font-bold text-slate-800 mb-2">¡Importación completada en Lote!</h3>
      <p className="text-slate-500 mb-6">Los costos confirmados se han guardado con éxito. Puedes revertir el reporte si es necesario.</p>
      <div className="flex gap-4 justify-center">
         <button onClick={onFinish} className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl">Nueva importación</button>
         {batchIdConfirmado && (
           <button onClick={handleRevertirLote} disabled={revertiendo} className="px-6 py-2.5 bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold rounded-xl transition-colors">
             {revertiendo ? 'Revirtiendo...' : 'Revertir último lote'}
           </button>
         )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6 max-w-full overflow-hidden">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Con Match', value: stats.sugerido, color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: 'Sin Match', value: stats.sin_match, color: 'text-slate-500', bg: 'bg-slate-50' },
          { label: 'Confirmados', value: stats.confirmado, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Rechazados', value: stats.rechazado, color: 'text-rose-500', bg: 'bg-rose-50' },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
         <span className="text-sm font-bold text-slate-600"> {numSeleccionados} </span>
         <span className="text-xs text-slate-400">asignados</span>
         <button onClick={() => {
            // "Marcar todas como Sin asignar"
            const nuevas = {...selecciones};
            Object.keys(nuevas).forEach(k => nuevas[k] = null);
            setSelecciones(nuevas);
         }} className="text-xs text-slate-500 hover:underline font-semibold bg-slate-100 px-2 py-1 rounded">Marcar todas como Sin Asignar</button>
         <button onClick={handleExportarSinMatchSistema} className="text-xs text-rose-600 hover:underline font-semibold bg-rose-50 px-2 py-1 rounded">Exportar Sin Match en Sistema</button>
         <button onClick={handleExportarNoAsignados} className="text-xs text-yellow-600 hover:underline font-semibold bg-yellow-50 px-2 py-1 rounded">Exportar No Asignados</button>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
         <span className="text-xs text-slate-400">Filtrar vista:</span>
         {(['todos', 'con_match', 'duda', 'sin_match'] as const).map((f) => (
            <button key={f} onClick={() => setFiltroVista(f)} className={cn('text-xs px-2 py-1 rounded-full border transition-colors', filtroVista === f ? 'bg-indigo-100 border-indigo-400 text-indigo-700 font-bold' : 'border-slate-200 text-slate-500 hover:border-indigo-300')}>
               {f === 'todos' ? 'Todos' : f === 'con_match' ? 'Solo Match (100%)' : f === 'duda' ? 'Revisar Sugeridos' : 'Sin Match'}
            </button>
         ))}
         <span className="text-xs text-slate-400 ml-2">({gruposFiltrados().length} cols)</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" /> Cargando matches...
        </div>
      ) : (
         <TablaComparacion 
           grupos={gruposFiltrados()} 
           selecciones={selecciones}
           onSelectCandidato={(clave, artId) => setSelecciones(p => ({ ...p, [clave]: artId }))}
           onRemapClick={clave => setRemapGrupoCostoId(clave)} 
         />
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-rose-600 text-sm font-semibold">
            <AlertCircle className="w-4 h-4 shrink-0" />{error}
            {erroresDetalle.length > 0 && (
              <button onClick={() => setErroresVisible((v) => !v)} className="ml-auto text-xs underline">
                {erroresVisible ? 'Ocultar' : 'Ver detalle'}
              </button>
            )}
          </div>
          {erroresVisible && erroresDetalle.length > 0 && (
            <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
              {erroresDetalle.map((e, i) => (
                <li key={i} className="text-xs text-rose-500 font-mono">{e.costo_id.slice(0, 8)}… — {e.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      
      {remapGrupoCostoId && (
        <RemapModal
          costoId={remapGrupoCostoId}
          onSelect={(articulo) => {
            // Actualizar remap pero sobre todo la selección
            setRemaps((r) => ({ ...r, [remapGrupoCostoId]: articulo }));
            setSelecciones((prev) => ({ ...prev, [remapGrupoCostoId]: articulo.articulo_id }));
            
            // Actualizar candidatos del registro original para embeber esta busqueda en el dropdown!
            setGrupos(prev => prev.map(g => {
               if (g.clave === remapGrupoCostoId) {
                  const exists = (g.candidatos_jsonb || []).some((x: any) => x.articulo_id === articulo.articulo_id);
                  if(!exists) {
                      return {
                          ...g,
                          candidatos_jsonb: [{
                             articulo_id: articulo.articulo_id,
                             nombre: articulo.nombre,
                             marca: articulo.marca,
                             modelo: articulo.modelo,
                             codigo_universal: articulo.codigo_universal || '',
                             puntaje_match: 100, // Conceptualmente equivalente para no romper contadores, pero
                             metodo_match: 'manual', // <- Diferenciador explícito
                             caja_madre: null
                          }, ...(g.candidatos_jsonb || [])]
                      }
                  }
               }
               return g;
            }));
            
            setRemapGrupoCostoId(null);
          }}
          onClose={() => setRemapGrupoCostoId(null)}
        />
      )}

      <div className="flex gap-3">
        <button onClick={onBack} className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-sm font-semibold">
          <ArrowLeft className="w-3.5 h-3.5" /> Volver
        </button>
        <button onClick={handleConfirmar} disabled={guardando || numSeleccionados === 0}
          className="flex-1 flex items-center justify-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-sm text-sm">
          {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
          {guardando ? 'Confirmando...' : `Confirmar Lote con ${numSeleccionados} asignados`}
        </button>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
function ImportarPreciosPageInner() {
  const sp = useSearchParams();
  const idParam = sp.get('id');

  const [step, setStep] = useState<1 | 2 | 3>(idParam ? 2 : 1);
  const [importacionId, setImportacionId] = useState<string | null>(idParam || null);
  const [matchStats, setMatchStats] = useState<{ total: number; con_match: number } | null>(null);

  const PASOS = ['Subir Excel', 'Mapear Columnas', 'Revisar Matches'];

  function reset() { setStep(1); setImportacionId(null); setMatchStats(null); }

  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">Importar Precios del Proveedor</h1>
        <p className="text-sm text-slate-500 mt-1">Sube un Excel, mapea las columnas y valida los matches con tu catálogo.</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-8">
        {PASOS.map((nombre, i) => (
          <div key={nombre} className="flex items-center gap-2">
            <StepIndicator step={i + 1} current={step} />
            <span className={cn('text-sm font-semibold hidden sm:inline', step === i + 1 ? 'text-indigo-600' : step > i + 1 ? 'text-emerald-600' : 'text-slate-400')}>{nombre}</span>
            {i < PASOS.length - 1 && (
              <div className="w-8 h-0.5 rounded-full mx-1" style={{ backgroundColor: step > i + 1 ? '#818cf8' : '#e2e8f0' }} />
            )}
          </div>
        ))}
      </div>

      {step === 1 && <PasoSubir onDone={({ id }) => { setImportacionId(id); setStep(2); }} />}
      {step === 2 && importacionId && (
        <PasoMapear importacionId={importacionId} onBack={() => {
           // Si vuelve al paso 1, limpiamos el id param para que se vea la subida desde 0
           const url = new URL(window.location.href);
           url.searchParams.delete('id');
           window.history.replaceState({}, '', url.toString());
           setStep(1); 
        }}
          onDone={(s) => { setMatchStats(s); setStep(3); }} />
      )}
      {step === 3 && importacionId && matchStats && (
        <PasoRevisar importacionId={importacionId} statsInit={matchStats}
          onBack={() => setStep(2)} onFinish={reset} />
      )}
    </div>
  );
}

export default function ImportarPreciosPage() {
  return (
    <Suspense fallback={<div className="p-10"><Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-600" /></div>}>
      <ImportarPreciosPageInner />
    </Suspense>
  );
}
