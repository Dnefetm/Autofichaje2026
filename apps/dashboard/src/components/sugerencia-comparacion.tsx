"use client";
import React from 'react';

/**
 * Comparación alineada entre la vitrina (publicación) y el artículo sugerido.
 * Columnas = campos comparables; renglón superior = vitrina, inferior = sugerido.
 * Colores y tipografía integrados al tema (variables CSS).
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
  const th = 'px-3 py-1.5 text-xs uppercase tracking-wider font-bold text-[var(--text-faint)]';
  const rowLabel = 'px-3 py-2 text-xs uppercase tracking-wider font-bold text-[var(--text-faint)] whitespace-nowrap';
  const cell = 'px-3 py-2 text-sm leading-snug break-words align-top';

  return (
    <div className="rounded-md border border-[var(--border)] overflow-hidden bg-[var(--surface-2)]/40">
      <div className="grid grid-cols-[64px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
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
        <div className={cell + ' font-semibold text-[var(--ok)]'}>{sug.nombre}</div>
        <div className={cell + ' text-[var(--ok)]'}>{sug.marca || '—'}</div>
        <div className={cell + ' font-mono text-[var(--ok)]'}>{sug.modelo || '—'}</div>
        <div className={cell + ' font-mono text-[var(--ok)]'}>{sug.codigo_universal || '—'}</div>
      </div>
      {sug.caja_madre && (
        <div className="px-3 py-2 text-sm border-t border-[var(--border)] text-[var(--warn)] font-semibold">
          Caja madre (sugerido): {sug.caja_madre}
        </div>
      )}
    </div>
  );
}
