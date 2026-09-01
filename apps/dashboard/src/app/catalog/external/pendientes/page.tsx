"use client";
import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import MappingModal from '@/components/mapping-modal';
import SugerenciaComparacion from '@/components/sugerencia-comparacion';
import { Package, Search, RefreshCw, Eye } from 'lucide-react';

interface Pendiente {
  id: string;
  external_item_id: string;
  titulo: string;
  brand: string | null;
  model: string | null;
  precio_venta: number | null;
  visits_30d: number | null;
  url_imagen: string | null;
  ean: string | null;
  gtin: string | null;
  upc: string | null;
  seller_sku: string | null;
  seller_custom_field: string | null;
  sync_disabled: boolean | null;
  sync_disabled_reason: string | null;
  _articulos_con_costo: number;
  _articulos_sin_costo: number;
  _cost_status: 'sin_mapeo' | 'costo_completo' | 'sin_costo' | 'parcial';
  _sugerencia: {
    articulo_id: string;
    nombre: string;
    marca: string | null;
    modelo: string | null;
    caja_madre: string | null;
    score: number;
    metodo: string;
    motivo: string;
  } | null;
}

const PAGE_SIZE = 50;

export default function PendientesPage() {
  const [rows, setRows] = useState<Pendiente[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [orderBy, setOrderBy] = useState<'visits_30d' | 'precio_venta' | 'actualizado_el'>(
    'visits_30d'
  );
  const [selected, setSelected] = useState<Pendiente | null>(null);
  const [sugerenciaInicial, setSugerenciaInicial] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        q: search,
        orderBy,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      const res = await fetch(`/api/publicaciones/pendientes?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setRows(json.rows || []);
      setTotal(json.total || 0);
    } catch (e) {
      console.error('Error cargando pendientes:', e);
    } finally {
      setLoading(false);
    }
  }, [search, orderBy, page]);

  useEffect(() => {
    load();
  }, [page, orderBy]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(0);
      load();
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  function costBadge(r: Pendiente) {
    switch (r._cost_status) {
      case 'costo_completo':
        return (
          <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-[var(--ok)]/15 text-[var(--ok)]">
            ✓ costo vigente
          </span>
        );
      case 'sin_costo':
        return (
          <span
            className="inline-block px-2 py-0.5 rounded-full text-xs bg-[var(--err)]/15 text-[var(--err)]"
            title="Artículo(s) mapeado(s) sin costo vigente. Importa la lista de precios del proveedor."
          >
            ⚠ sin costo
          </span>
        );
      case 'parcial':
        return (
          <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-[var(--warn)]/15 text-[var(--warn)]">
            {r._articulos_con_costo}/{r._articulos_con_costo + r._articulos_sin_costo} con costo
          </span>
        );
      default:
        return (
          <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-[var(--surface-2)] text-[var(--text-muted)]">
            sin mapeo
          </span>
        );
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Encabezado */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)] flex items-center gap-2">
            <Package className="w-6 h-6" /> Cola de mapeo pendiente
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {total.toLocaleString()} publicaciones sin vincular con bodega física. Prioriza por{' '}
            <select
              className="ml-1 border border-slate-300 rounded px-2 py-0.5 text-sm"
              value={orderBy}
              onChange={(e) => {
                setPage(0);
                setOrderBy(e.target.value as any);
              }}
            >
              <option value="visits_30d">visitas 30d</option>
              <option value="precio_venta">precio</option>
              <option value="actualizado_el">actualización</option>
            </select>
          </p>
        </div>
        <button
          onClick={load}
          className="px-3 py-2 bg-[var(--surface-2)] hover:bg-slate-200 rounded-lg flex items-center gap-2 text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refrescar
        </button>
      </div>

      {/* Búsqueda */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-faint)]" />
        <input
          className="w-full pl-10 pr-4 py-2 bg-[var(--surface)] border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--accent)]"
          placeholder="Filtrar por título, MLM, marca, modelo, SKU o EAN/GTIN..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Tarjetas de ancho completo */}
      <div className="space-y-4">
        {rows.map((r) => (
          <div key={r.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
            {/* Cabecera de tarjeta */}
            <div className="flex items-start gap-3">
              {r.url_imagen && (
                <img src={r.url_imagen} alt="" className="w-14 h-14 rounded-lg object-cover border border-[var(--border)] shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[var(--text)] leading-snug line-clamp-2">
                  {r.titulo}
                </div>
                <div className="text-xs text-[var(--text-muted)] font-mono mt-0.5">{r.external_item_id}</div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-sm text-[var(--text-muted)]">
                  <span className="font-mono font-semibold text-[var(--text)]">
                    ${r.precio_venta?.toLocaleString() ?? '—'}
                  </span>
                  <span>{r.visits_30d ?? '—'} visitas 30d</span>
                  {costBadge(r)}
                  {r.sync_disabled ? (
                    <span className="text-[var(--warn)]">sync pausado</span>
                  ) : (
                    <span>sync activo</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                {r._sugerencia && (
                  <button
                    onClick={() => { setSugerenciaInicial(r._sugerencia); setSelected(r); }}
                    className="px-3 py-1.5 bg-[var(--accent)] hover:brightness-110 text-[var(--accent-ink)] rounded-lg text-sm font-semibold"
                  >
                    Mapear con sugerido
                  </button>
                )}
                <button
                  onClick={() => { setSugerenciaInicial(null); setSelected(r); }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${r._sugerencia ? 'bg-[var(--surface-2)] hover:brightness-110 text-[var(--text-muted)]' : 'bg-[var(--accent)] hover:brightness-110 text-[var(--accent-ink)]'}`}
                >
                  Mapear
                </button>
                <Link
                  href={`/catalog/external/${r.id}`}
                  className="inline-flex items-center gap-1 px-2 py-1.5 bg-[var(--surface-2)] hover:brightness-110 text-[var(--text-muted)] rounded-lg text-sm"
                >
                  <Eye className="w-4 h-4" /> Ver
                </Link>
              </div>
            </div>

            {/* Comparación a ancho completo */}
            {r._sugerencia && (
              <div className="mt-3">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--ok)] mb-1">
                  Sugerencia {r._sugerencia.score}% · {r._sugerencia.motivo}
                </div>
                <SugerenciaComparacion
                  pub={{
                    titulo: r.titulo,
                    brand: r.brand,
                    model: r.model,
                    sku: r.seller_custom_field || r.seller_sku,
                    codigo: r.gtin || r.ean || r.upc,
                  }}
                  sug={r._sugerencia}
                />
              </div>
            )}
          </div>
        ))}

        {!loading && rows.length === 0 && (
          <div className="p-10 text-center text-[var(--text-muted)] bg-[var(--surface)] border border-[var(--border)] rounded-lg">
            Sin resultados.
          </div>
        )}
      </div>

      {/* Paginación */}
      <div className="flex items-center justify-between mt-4 text-sm text-[var(--text-muted)]">
        <div>
          Página {page + 1} de {Math.max(1, Math.ceil(total / PAGE_SIZE))}
        </div>
        <div className="flex gap-2">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="px-3 py-1.5 bg-[var(--surface-2)] hover:bg-slate-200 rounded-lg disabled:opacity-40"
          >
            Anterior
          </button>
          <button
            disabled={(page + 1) * PAGE_SIZE >= total}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 bg-[var(--surface-2)] hover:bg-slate-200 rounded-lg disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      </div>

      {selected && (
        <MappingModal
          listing={selected}
          sugerenciaInicial={sugerenciaInicial}
          onClose={() => { setSelected(null); setSugerenciaInicial(null); }}
          onSuccess={() => {
            setSelected(null);
            setSugerenciaInicial(null);
            load();
          }}
        />
      )}
    </div>
  );
}
