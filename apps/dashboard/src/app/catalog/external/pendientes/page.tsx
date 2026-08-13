"use client";
import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import MappingModal from '@/components/mapping-modal';
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
  marketplace_id: string;
  ean: string | null;
  gtin: string | null;
  upc: string | null;
  seller_sku: string | null;
  seller_custom_field: string | null;
  domain_id: string | null;
  condition: string | null;
  tipo_publicacion: string | null;
  par_item_id: string | null;
  id_producto_catalogo: string | null;
  sync_disabled: boolean | null;
  sync_disabled_reason: string | null;
  pricing_status: string | null;
  sale_price_calculated: number | null;
  _articulos_con_costo: number;
  _articulos_sin_costo: number;
  _cost_status: 'sin_mapeo' | 'costo_completo' | 'sin_costo' | 'parcial';
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
          <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-800">
            ✓ costo vigente
          </span>
        );
      case 'sin_costo':
        return (
          <span
            className="inline-block px-2 py-0.5 rounded-full text-xs bg-rose-100 text-rose-800"
            title="Artículo(s) mapeado(s) sin costo vigente. Importa la lista de precios del proveedor."
          >
            ⚠ sin costo
          </span>
        );
      case 'parcial':
        return (
          <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800">
            {r._articulos_con_costo}/{r._articulos_con_costo + r._articulos_sin_costo} con costo
          </span>
        );
      default:
        return (
          <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600">
            sin mapeo
          </span>
        );
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Package className="w-6 h-6" /> Cola de mapeo pendiente
          </h1>
          <p className="text-sm text-slate-500 mt-1">
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
          className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-2 text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refrescar
        </button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          className="w-full pl-10 pr-4 py-2 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
          placeholder="Filtrar por título, MLM, marca, modelo, SKU o EAN/GTIN..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-2 text-left">Publicación</th>
              <th className="p-2 text-left">Marca / Modelo</th>
              <th className="p-2 text-right">Precio</th>
              <th className="p-2 text-right">Visitas 30d</th>
              <th className="p-2 text-left">Estado costo</th>
              <th className="p-2 text-left">Sync</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="p-2">
                  <div className="flex items-center gap-2">
                    {r.url_imagen && (
                      <img src={r.url_imagen} alt="" className="w-10 h-10 rounded object-cover" />
                    )}
                    <div>
                      <div className="font-medium text-slate-800 line-clamp-2 max-w-md">
                        {r.titulo}
                      </div>
                      <div className="text-xs text-slate-500">{r.external_item_id}</div>
                    </div>
                  </div>
                </td>
                <td className="p-2 text-slate-700">
                  {r.brand && <div>{r.brand}</div>}
                  {r.model && <div className="text-xs text-slate-500">Mod: {r.model}</div>}
                </td>
                <td className="p-2 text-right font-mono">
                  ${r.precio_venta?.toLocaleString() ?? '—'}
                </td>
                <td className="p-2 text-right font-mono">{r.visits_30d ?? '—'}</td>
                <td className="p-2">{costBadge(r)}</td>
                <td className="p-2">
                  {r.sync_disabled ? (
                    <span
                      className="inline-block px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800"
                      title={r.sync_disabled_reason || ''}
                    >
                      pausado
                    </span>
                  ) : (
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600">
                      activo
                    </span>
                  )}
                </td>
                <td className="p-2">
                  <button
                    onClick={() => setSelected(r)}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium"
                  >
                    Mapear
                  </button>
                  <Link
                    href={`/catalog/external/${r.id}`}
                    className="ml-2 inline-flex items-center gap-1 px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs"
                  >
                    <Eye className="w-3 h-3" /> Ver
                  </Link>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-slate-500">
                  Sin resultados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3 text-sm text-slate-600">
        <div>
          Página {page + 1} de {Math.max(1, Math.ceil(total / PAGE_SIZE))}
        </div>
        <div className="flex gap-2">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-40"
          >
            Anterior
          </button>
          <button
            disabled={(page + 1) * PAGE_SIZE >= total}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      </div>

      {selected && (
        <MappingModal
          listing={selected}
          onClose={() => setSelected(null)}
          onSuccess={() => {
            setSelected(null);
            load();
          }}
        />
      )}
    </div>
  );
}
