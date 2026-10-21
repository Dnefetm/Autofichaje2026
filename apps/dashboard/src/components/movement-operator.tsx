"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Page } from '@/components/ui/Page';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Btn } from '@/components/ui/Btn';
import { Badge } from '@/components/ui/Badge';
import { supabaseBrowser } from '@/lib/supabase-browser';
import {
  ArrowDownToLine, ArrowUpFromLine, Camera, Loader2, Package, ScanLine, Search, X,
} from 'lucide-react';
import { toast } from 'sonner';

type TipoMovimiento = 'ingreso' | 'egreso';

interface Articulo {
  articulo_id: string;
  modelo: string | null;
  marca: string | null;
  codigo_universal: string | null;
  descripcion: string | null;
  nombre: string | null;
  caja_madre: string | null;
  variante: string | null;
}

interface Operador {
  id: string;
  nombre: string;
}

interface Movimiento {
  tipo: 'ingreso' | 'egreso';
  id: string;
  articulo_id: string | null;
  nombre_articulo: string | null;
  cantidad: number | null;
  tipo_movimiento: string | null;
  fecha: string | null;
  operador_id: string | null;
  notas: string | null;
  imagenes: string[];
}

interface Foto {
  path: string;
  preview: string;
}

const MAX_FOTOS = 5;

const TIPOS_INGRESO = ['Compra', 'Otro', 'Retiro Full', 'Devolución a Selecto MX'];
const TIPOS_EGRESO = ['venta', 'envio_full', 'otro'];

// Comprimir en el navegador (Canvas, acelerado por hardware) → WebP máx 1280px, ~150KB.
// Sin Sharp en Vercel. Patrón reutilizado de fichas/[id]/page.tsx (compressImage).
function comprimirImagen(file: File): Promise<File> {
  return new Promise((resolve) => {
    if (!file || !file.type || !file.type.startsWith('image/')) return resolve(file);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        const max = 1280;
        if (w > max || h > max) {
          if (w > h) { h = Math.round((h * max) / w); w = max; }
          else { w = Math.round((w * max) / h); h = max; }
        }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(file);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (!blob) return resolve(file);
          const safe = (file.name || 'imagen.jpg').replace(/\.[^/.]+$/, '') + '.webp';
          resolve(new File([blob], safe, { type: 'image/webp', lastModified: Date.now() }));
        }, 'image/webp', 0.82);
      } catch {
        resolve(file);
      }
    };
    img.src = url;
  });
}

// Sube UNA foto comprimida directo cliente → Storage (bucket privado) y devuelve el path.
async function subirFoto(file: File): Promise<string> {
  const comprimida = await comprimirImagen(file);

  const r = await fetch('/api/movimientos/foto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ext: comprimida.type === 'image/webp' ? 'webp' : 'jpg' }),
  });
  const j = await r.json();
  if (!j.ok || !j.path || !j.token) throw new Error(j.error || 'No se pudo preparar la subida');

  const sb = supabaseBrowser();
  const { error: upErr } = await sb.storage.from(j.bucket).uploadToSignedUrl(j.path, j.token, comprimida);
  if (upErr) throw new Error(upErr.message || 'Error subiendo foto');

  return j.path;
}

const inputBase =
  'w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius-sm)] ' +
  'px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] ' +
  'focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-colors';

export function MovementOperator({
  articuloId,
  tipoInicial,
}: {
  articuloId?: string | null;
  tipoInicial?: TipoMovimiento;
}) {
  const [tipo, setTipo] = useState<TipoMovimiento>(tipoInicial ?? 'egreso');

  // Búsqueda de artículo
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState<Articulo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [articulo, setArticulo] = useState<Articulo | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Operadores (cache en memoria; pocas filas, casi no cambian)
  const [operadores, setOperadores] = useState<Operador[]>([]);

  // Formulario
  const [cantidad, setCantidad] = useState('');
  const [tipoMov, setTipoMov] = useState('');
  const [operadorId, setOperadorId] = useState('');
  const [nota, setNota] = useState('');
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [subiendoFoto, setSubiendoFoto] = useState(false);

  const [guardando, setGuardando] = useState(false);

  // Historial reciente
  const [recientes, setRecientes] = useState<Movimiento[]>([]);

  // Escáner
  const [escanerAbierto, setEscanerAbierto] = useState(false);
  const [escanerError, setEscanerError] = useState<string | null>(null);
  const escanerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cargarOperadores = useCallback(async () => {
    try {
      const r = await fetch('/api/operadores');
      const j = await r.json();
      if (Array.isArray(j.operadores)) setOperadores(j.operadores);
    } catch { /* silencioso */ }
  }, []);

  const cargarRecientes = useCallback(async () => {
    try {
      const r = await fetch('/api/movimientos?limit=15');
      const j = await r.json();
      if (Array.isArray(j.movimientos)) setRecientes(j.movimientos);
    } catch { /* silencioso */ }
  }, []);

  // Pre-carga del artículo cuando se llega desde la ficha del catálogo.
  useEffect(() => {
    if (!articuloId) return;
    (async () => {
      try {
        const r = await fetch(`/api/articulos/${encodeURIComponent(articuloId)}`);
        if (!r.ok) return;
        const j = await r.json();
        if (j.articulo) {
          const a = j.articulo;
          setArticulo({
            articulo_id: a.articulo_id,
            modelo: a.modelo ?? null,
            marca: a.marca ?? null,
            codigo_universal: a.codigo_universal ?? null,
            descripcion: a.descripcion ?? null,
            nombre: a.nombre ?? null,
            caja_madre: a.caja_madre ?? null,
            variante: a.variante ?? null,
          });
        }
      } catch { /* silencioso */ }
    })();
  }, [articuloId]);

  useEffect(() => { cargarOperadores(); cargarRecientes(); }, [cargarOperadores, cargarRecientes]);

  const buscar = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q || q.trim().length < 2) { setResultados([]); setBuscando(false); return; }
    setBuscando(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/articulos/buscar?query=${encodeURIComponent(q.trim())}&limit=10`);
        const j = await r.json();
        if (Array.isArray(j.items)) setResultados(j.items);
      } catch { /* silencioso */ } finally {
        setBuscando(false);
      }
    }, 300);
  }, []);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const elegirArticulo = (a: Articulo) => {
    setArticulo(a);
    setResultados([]);
    setQuery('');
  };

  const tipos = tipo === 'ingreso' ? TIPOS_INGRESO : TIPOS_EGRESO;

  // Escáner html5-qrcode (mismo patrón que envios/preparacion).
  useEffect(() => {
    if (!escanerAbierto) return;
    let scanner: any = null;
    let cancelado = false;
    (async () => {
      try {
        const mod = await import('html5-qrcode');
        if (cancelado) return;
        scanner = new mod.Html5Qrcode('movement-scanner');
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: (vw: number, vh: number) => ({ width: Math.floor(vw * 0.9), height: Math.floor(vh * 0.4) }) },
          async (text: string) => {
            const t = String(text ?? '').trim();
            if (!t) return;
            setEscanerAbierto(false);
            try {
              const r = await fetch(`/api/articulos/buscar?query=${encodeURIComponent(t)}&limit=5`);
              const j = await r.json();
              if (Array.isArray(j.items) && j.items.length > 0) {
                elegirArticulo(j.items[0]);
              } else {
                toast.error(`Código no encontrado: ${t}`);
              }
            } catch { toast.error('No se pudo buscar el código.'); }
          },
          () => {},
        );
      } catch (e: any) {
        if (!cancelado) setEscanerError(e?.message || 'No se pudo iniciar la cámara');
      }
    })();
    return () => {
      cancelado = true;
      if (scanner) scanner.stop().catch(() => {});
    };
  }, [escanerAbierto]);

  const tomarFotos = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(ev.target.files ?? []);
    ev.target.value = '';
    if (files.length === 0) return;

    const libres = MAX_FOTOS - fotos.length;
    if (libres <= 0) { toast.error(`Máximo ${MAX_FOTOS} fotos por movimiento`); return; }
    const aSubir = files.slice(0, libres);
    if (files.length > libres) toast.error(`Solo se adjuntan ${libres} foto(s) más (máx ${MAX_FOTOS})`);

    setSubiendoFoto(true);
    try {
      const nuevas: Foto[] = [];
      for (const file of aSubir) {
        const path = await subirFoto(file);
        nuevas.push({ path, preview: URL.createObjectURL(file) });
      }
      setFotos((prev) => [...prev, ...nuevas]);
      toast.success(`${nuevas.length} foto(s) adjuntada(s)`);
    } catch (e: any) {
      toast.error(e?.message || 'Error al subir la foto');
    } finally {
      setSubiendoFoto(false);
    }
  };

  const quitarFoto = (idx: number) => {
    setFotos((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      URL.revokeObjectURL(prev[idx]?.preview ?? '');
      return next;
    });
  };

  const resetForm = () => {
    setArticulo(null);
    setCantidad('');
    setTipoMov('');
    setNota('');
    setFotos((prev) => { prev.forEach((f) => URL.revokeObjectURL(f.preview)); return []; });
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      const payload: Record<string, unknown> = { tipo };
      if (articulo) payload.articulo_id = articulo.articulo_id;
      if (cantidad.trim() !== '') payload.cantidad = parseInt(cantidad, 10) || 0;
      if (tipoMov) payload[tipo === 'ingreso' ? 'tipo_ingreso' : 'tipo_egreso'] = tipoMov;
      if (operadorId) payload.operador_id = operadorId;
      if (nota.trim()) payload.notas = nota.trim();
      if (fotos.length > 0) payload.imagenes = fotos.map((f) => f.path);

      const r = await fetch('/api/movimientos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Error al guardar');
      toast.success(`${tipo === 'ingreso' ? 'Ingreso' : 'Egreso'} registrado`);
      resetForm();
      await cargarRecientes();
    } catch (e: any) {
      toast.error(e?.message || 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  };

  const nombreOperador = useMemo(() => {
    const map = new Map(operadores.map((o) => [o.id, o.nombre]));
    return (id: string | null) => (id ? map.get(id) || id : null);
  }, [operadores]);

  const columnas: Column<Movimiento>[] = [
    {
      key: 'tipo', label: 'Tipo', width: '64px',
      render: (m) => <Badge tone={m.tipo === 'ingreso' ? 'success' : 'warning'}>{m.tipo === 'ingreso' ? 'IN' : 'OUT'}</Badge>,
    },
    {
      key: 'articulo', label: 'Artículo',
      render: (m) => (
        <div className="min-w-0">
          <p className="text-sm text-[var(--text)] truncate">{m.nombre_articulo || m.articulo_id || '(sin artículo)'}</p>
          {m.notas && <p className="text-[11px] text-[var(--text-faint)] truncate">{m.notas}</p>}
        </div>
      ),
    },
    { key: 'cantidad', label: 'Cant.', align: 'right', width: '70px', render: (m) => m.cantidad != null ? `${m.cantidad}` : '—' },
    { key: 'tipo_movimiento', label: 'Movimiento', render: (m) => m.tipo_movimiento || '—' },
    {
      key: 'operador', label: 'Operador',
      render: (m) => m.operador_id ? nombreOperador(m.operador_id) : '—',
    },
    {
      key: 'fecha', label: 'Fecha',
      render: (m) => m.fecha ? new Date(m.fecha).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—',
    },
    {
      key: 'foto', label: 'Foto', align: 'right', width: '56px',
      render: (m) => m.imagenes.length > 0 ? <Camera className="w-3.5 h-3.5 text-[var(--info)]" /> : null,
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Movimientos"
        description="Registra ingresos y egresos de bodega. Solo el ID es obligatorio (se genera automáticamente)."
      />

      {/* Toggle tipo */}
      <div className="flex rounded-[var(--radius)] border border-[var(--border)] overflow-hidden w-fit">
        <button
          onClick={() => setTipo('ingreso')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold transition-colors ${tipo === 'ingreso' ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
        >
          <ArrowDownToLine className="w-4 h-4" /> Ingreso
        </button>
        <button
          onClick={() => setTipo('egreso')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold transition-colors ${tipo === 'egreso' ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
        >
          <ArrowUpFromLine className="w-4 h-4" /> Egreso
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Columna formulario */}
        <Card title={`Registrar ${tipo}`}>
          <div className="p-4 space-y-4">
            {/* Artículo */}
            <FormField label="Artículo (opcional)">
              {articulo ? (
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
                  <Package className="w-4 h-4 text-[var(--accent)] mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--text)] truncate">{articulo.nombre || articulo.articulo_id}</p>
                    <p className="text-xs text-[var(--text-faint)] font-mono truncate">{articulo.articulo_id}{articulo.marca ? ` · ${articulo.marca}` : ''}{articulo.modelo ? ` · ${articulo.modelo}` : ''}</p>
                    {articulo.caja_madre && <p className="text-xs text-[var(--info)]">📍 {articulo.caja_madre}</p>}
                  </div>
                  <Btn size="sm" variant="ghost" onClick={() => setArticulo(null)}><X className="w-3.5 h-3.5" /></Btn>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-faint)]" />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); buscar(e.target.value); }}
                    placeholder="Buscar por SKU, EAN, nombre…"
                    className={`${inputBase} pl-9`}
                  />
                  <button
                    onClick={() => { setEscanerError(null); setEscanerAbierto(true); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--accent)] hover:brightness-110"
                    title="Escanear código de barras"
                  >
                    <ScanLine className="w-5 h-5" />
                  </button>
                </div>
              )}
              {!articulo && buscando && (
                <p className="text-xs text-[var(--text-faint)] mt-1.5 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Buscando…</p>
              )}
              {!articulo && resultados.length > 0 && (
                <div className="mt-1.5 border border-[var(--border)] rounded-lg divide-y divide-[var(--border)] max-h-60 overflow-auto">
                  {resultados.map((a) => (
                    <button key={a.articulo_id} onClick={() => elegirArticulo(a)} className="w-full text-left px-3 py-2 hover:bg-[var(--surface-2)] transition-colors">
                      <p className="text-sm text-[var(--text)] truncate">{a.nombre || a.articulo_id}</p>
                      <p className="text-[11px] text-[var(--text-faint)] font-mono truncate">{a.articulo_id}{a.caja_madre ? ` · 📍 ${a.caja_madre}` : ''}</p>
                    </button>
                  ))}
                </div>
              )}
            </FormField>

            {/* Cantidad + tipo */}
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Cantidad">
                <input
                  type="number" min={0} inputMode="numeric" value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                  placeholder="0"
                  className={inputBase}
                />
              </FormField>
              <FormField label="Tipo">
                <select value={tipoMov} onChange={(e) => setTipoMov(e.target.value)} className={inputBase}>
                  <option value="">—</option>
                  {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </FormField>
            </div>

            {/* Operador */}
            <FormField label="Operador">
              <select value={operadorId} onChange={(e) => setOperadorId(e.target.value)} className={inputBase}>
                <option value="">—</option>
                {operadores.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </select>
            </FormField>

            {/* Nota */}
            <FormField label="Nota">
              <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} placeholder="Ej. Merma, caja dañada…" className={`${inputBase} resize-y`} />
            </FormField>

            {/* Fotos (hasta 5) */}
            <FormField label={`Fotos (${fotos.length}/${MAX_FOTOS}, opcional)`}>
              {fotos.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-2">
                  {fotos.map((f, i) => (
                    <div key={f.path} className="relative aspect-square rounded-lg border border-[var(--border)] overflow-hidden group">
                      <img src={f.preview} alt="" className="w-full h-full object-cover bg-white" />
                      <span className="absolute top-1 left-1 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">#{i + 1}</span>
                      <button
                        onClick={() => quitarFoto(i)}
                        className="absolute top-1 right-1 p-1 bg-[var(--err)]/80 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Quitar foto"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <Btn
                size="sm"
                variant="outline"
                loading={subiendoFoto}
                icon={<Camera className="w-4 h-4" />}
                onClick={() => fileInputRef.current?.click()}
                disabled={fotos.length >= MAX_FOTOS}
              >
                {subiendoFoto ? 'Subiendo…' : fotos.length >= MAX_FOTOS ? 'Máx. 5 fotos' : 'Tomar foto'}
              </Btn>
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={tomarFotos} />
            </FormField>

            <div className="flex justify-end pt-1">
              <Btn onClick={guardar} loading={guardando} icon={tipo === 'ingreso' ? <ArrowDownToLine className="w-4 h-4" /> : <ArrowUpFromLine className="w-4 h-4" />}>
                {guardando ? 'Guardando…' : `Guardar ${tipo}`}
              </Btn>
            </div>
          </div>
        </Card>

        {/* Columna historial */}
        <Card title="Últimos movimientos">
          <DataTable
            columns={columnas}
            rows={recientes}
            rowKey={(m) => `${m.tipo}-${m.id}`}
            empty="Sin movimientos recientes."
            dense
          />
        </Card>
      </div>

      {/* Modal escáner */}
      {escanerAbierto && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70" onClick={() => setEscanerAbierto(false)}>
          <div className="w-full max-w-md bg-[var(--surface)] rounded-xl border border-[var(--border)] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[var(--text)]">Escanear código de barras</h3>
              <Btn size="sm" variant="ghost" onClick={() => setEscanerAbierto(false)}><X className="w-4 h-4" /></Btn>
            </div>
            <div id="movement-scanner" className="mt-3 rounded-lg overflow-hidden" />
            {escanerError && <p className="text-xs text-[var(--err)] mt-2">⚠️ {escanerError}</p>}
            <p className="text-xs text-[var(--text-faint)] mt-2">Apunta al código de barras (EAN/UPC) del producto.</p>
          </div>
        </div>
      )}
    </Page>
  );
}
