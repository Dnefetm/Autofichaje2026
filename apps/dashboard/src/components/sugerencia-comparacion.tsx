"use client";
import React from 'react';
import { Package, Building2 } from 'lucide-react';

/**
 * Comparación vertical entre la vitrina (publicación) y el artículo del catálogo.
 * H6 (POLITICAS_FRONTEND.md): comparación vertical, NO lado a lado.
 * Tabla HTML nativa: Fila Superior = Catálogo, Fila Inferior = Vitrina.
 * Las discrepancias se marcan en ámbar/negritas (H4) para dirigir el ojo.
 */
export interface SugerenciaComparacionProps {
  pub: {
    titulo?: string | null;
    brand?: string | null;
    model?: string | null;
    sku?: string | null;
    codigo?: string | null; // ean / gtin / upc
  };
  sug: {
    nombre: string;
    marca?: string | null;
    modelo?: string | null;
    variante?: string | null;
    codigo_universal?: string | null;
    caja_madre?: string | null;
  };
}

function diff(a: string, b: string): boolean {
  return !!a && !!b && a.trim().toLowerCase() !== b.trim().toLowerCase();
}

export default function SugerenciaComparacion({ pub, sug }: SugerenciaComparacionProps) {
  const pubNombre = pub.titulo || '—';
  const pubMarca = pub.brand || '—';
  const pubModeloSku = pub.sku || pub.model || '—';
  const pubCodigo = pub.codigo || '—';
  const sugNombre = sug.nombre || '—';
  const sugMarca = sug.marca || '—';
  const sugModelo = sug.modelo || '—';
  const sugCodigo = sug.codigo_universal || '—';

  const dMarca = diff(sugMarca, pubMarca);
  const dModelo = diff(sugModelo, pubModeloSku);
  const dCodigo = diff(sugCodigo, pubCodigo);

  const warn = 'text-[var(--warn)] font-bold';
  const muted = 'text-[var(--text-muted)]';

  return (
    <div className="rounded-md border border-[var(--border)] overflow-hidden bg-[var(--surface-2)]/40">
      {/* Escritorio: tabla nativa, columnas = campos, escaneo vertical */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-[var(--surface-2)]">
            <tr className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)] border-b border-[var(--border)]">
              <th className="py-1.5 px-3 text-left w-24">Origen</th>
              <th className="py-1.5 px-3 text-left">Nombre</th>
              <th className="py-1.5 px-3 text-left">Marca</th>
              <th className="py-1.5 px-3 text-left">Modelo/SKU</th>
              <th className="py-1.5 px-3 text-left">Código</th>
            </tr>
          </thead>
          <tbody>
            {/* Fila Superior: Catálogo */}
            <tr className="align-top">
              <td className="py-1.5 px-3">
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)]">
                  <Package className="w-3.5 h-3.5" /> Catálogo
                </span>
              </td>
              <td className="py-1.5 px-3 font-semibold text-[var(--text)] break-words">{sugNombre}</td>
              <td className={`py-1.5 px-3 ${dMarca ? warn : muted}`}>{sugMarca}</td>
              <td className={`py-1.5 px-3 font-mono ${dModelo ? warn : muted}`}>{sugModelo}</td>
              <td className={`py-1.5 px-3 font-mono ${dCodigo ? warn : muted}`}>{sugCodigo}</td>
            </tr>
            {/* Fila Inferior: Vitrina */}
            <tr className="align-top">
              <td className="py-1.5 px-3 border-b border-[var(--border)]">
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
                  <Building2 className="w-3.5 h-3.5" /> Vitrina
                </span>
              </td>
              <td className="py-1.5 px-3 border-b border-[var(--border)] text-[var(--text)] break-words">{pubNombre}</td>
              <td className={`py-1.5 px-3 border-b border-[var(--border)] ${dMarca ? warn : muted}`}>{pubMarca}</td>
              <td className={`py-1.5 px-3 border-b border-[var(--border)] font-mono ${dModelo ? warn : muted}`}>{pubModeloSku}</td>
              <td className={`py-1.5 px-3 border-b border-[var(--border)] font-mono ${dCodigo ? warn : muted}`}>{pubCodigo}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Móvil: apilado campo por campo (Catálogo arriba / Vitrina abajo) */}
      <div className="md:hidden divide-y divide-[var(--border)] break-words">
        <div className="px-3 py-2.5">
          <div className="text-xs uppercase tracking-wider font-bold text-[var(--text-faint)] mb-1">Nombre</div>
          <div className="text-sm text-[var(--text)] leading-snug"><span className="font-semibold text-[var(--text-faint)]">Catálogo: </span><span className="font-semibold">{sugNombre}</span></div>
          <div className="text-sm text-[var(--text-muted)] leading-snug"><span className="font-semibold text-[var(--text-faint)]">Vitrina: </span>{pubNombre}</div>
        </div>
        <div className="px-3 py-2.5">
          <div className="text-xs uppercase tracking-wider font-bold text-[var(--text-faint)] mb-1">Marca</div>
          <div className={`text-sm leading-snug ${dMarca ? warn : muted}`}><span className="font-semibold text-[var(--text-faint)]">Catálogo: </span>{sugMarca}</div>
          <div className={`text-sm leading-snug ${dMarca ? warn : muted}`}><span className="font-semibold text-[var(--text-faint)]">Vitrina: </span>{pubMarca}</div>
        </div>
        <div className="px-3 py-2.5">
          <div className="text-xs uppercase tracking-wider font-bold text-[var(--text-faint)] mb-1">Modelo / SKU</div>
          <div className={`text-sm leading-snug font-mono ${dModelo ? warn : muted}`}><span className="font-semibold text-[var(--text-faint)]">Catálogo: </span>{sugModelo}</div>
          <div className={`text-sm leading-snug font-mono ${dModelo ? warn : muted}`}><span className="font-semibold text-[var(--text-faint)]">Vitrina: </span>{pubModeloSku}</div>
        </div>
        <div className="px-3 py-2.5">
          <div className="text-xs uppercase tracking-wider font-bold text-[var(--text-faint)] mb-1">Código</div>
          <div className={`text-sm leading-snug font-mono ${dCodigo ? warn : muted}`}><span className="font-semibold text-[var(--text-faint)]">Catálogo: </span>{sugCodigo}</div>
          <div className={`text-sm leading-snug font-mono ${dCodigo ? warn : muted}`}><span className="font-semibold text-[var(--text-faint)]">Vitrina: </span>{pubCodigo}</div>
        </div>
      </div>

      {(sug.variante || sug.caja_madre) && (
        <div className="px-3 py-2 text-sm border-t border-[var(--border)] space-y-0.5">
          {sug.variante && (
            <div className="text-[var(--info)] font-semibold">Variante (catálogo): {sug.variante}</div>
          )}
          {sug.caja_madre && (
            <div className="text-[var(--warn)] font-semibold">Caja madre (catálogo): {sug.caja_madre}</div>
          )}
        </div>
      )}
    </div>
  );
}
