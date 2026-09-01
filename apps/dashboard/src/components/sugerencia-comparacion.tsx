"use client";
import React from 'react';

/**
 * Comparación alineada entre la vitrina (publicación) y el artículo sugerido.
 * Layout solicitado por el operador:
 *   - columnas = campos comparables (Nombre, Marca, Modelo/SKU, Código)
 *   - renglón superior = vitrina (publicación)
 *   - renglón inferior  = sugerido (catálogo)
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
    codigo_universal?: string | null;
    caja_madre?: string | null;
  };
}

export default function SugerenciaComparacion({ pub, sug }: SugerenciaComparacionProps) {
  const th = 'px-2 py-1 text-[9px] uppercase tracking-wider font-bold text-[var(--text-faint)]';
  const rowLabel = 'px-2 py-1 text-[9px] uppercase tracking-wider font-bold text-[var(--text-faint)] whitespace-nowrap';
  const cell = 'px-2 py-1 text-[11px] leading-snug break-words align-top';

  return (
    <div className="rounded-md border border-[var(--accent)]/30 overflow-hidden bg-[var(--surface)]">
      <div className="grid grid-cols-[46px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className={th}></div>
        <div className={th}>Nombre</div>
        <div className={th}>Marca</div>
        <div className={th}>Modelo/SKU</div>
        <div className={th}>Código</div>

        {/* renglón superior: vitrina */}
        <div className={rowLabel}>Vitrina</div>
        <div className={cell + ' text-[var(--text)]'}>{pub.titulo || '—'}</div>
        <div className={cell + ' text-[var(--text)]'}>{pub.brand || '—'}</div>
        <div className={cell + ' font-mono text-[var(--text)]'}>{pub.sku || pub.model || '—'}</div>
        <div className={cell + ' font-mono text-[var(--text)]'}>{pub.codigo || '—'}</div>

        {/* renglón inferior: sugerido */}
        <div className={rowLabel}>Sugerido</div>
        <div className={cell + ' font-semibold text-emerald-700'}>{sug.nombre}</div>
        <div className={cell + ' text-emerald-700'}>{sug.marca || '—'}</div>
        <div className={cell + ' font-mono text-emerald-700'}>{sug.modelo || '—'}</div>
        <div className={cell + ' font-mono text-emerald-700'}>{sug.codigo_universal || '—'}</div>
      </div>
      {sug.caja_madre && (
        <div className="px-2 py-1 text-[11px] border-t border-[var(--border)] text-amber-600 font-bold">
          Caja madre (sugerido): {sug.caja_madre}
        </div>
      )}
    </div>
  );
}
