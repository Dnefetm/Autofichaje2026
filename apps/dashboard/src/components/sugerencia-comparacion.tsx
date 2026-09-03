"use client";
import React from 'react';

/**
 * Comparación alineada entre la vitrina (publicación) y el artículo sugerido.
 * - Escritorio (md+): columnas = campos (Nombre, Marca, Modelo/SKU, Código);
 *   renglón superior = vitrina, inferior = sugerido.
 * - Móvil (<md): apilado vertical, campo por campo, vitrina arriba y sugerido abajo.
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
    variante?: string | null;
    codigo_universal?: string | null;
    caja_madre?: string | null;
  };
}

export default function SugerenciaComparacion({ pub, sug }: SugerenciaComparacionProps) {
  const th = 'px-3 py-1.5 text-xs uppercase tracking-wider font-bold text-[var(--text-faint)]';
  const rowLabel = 'px-3 py-2 text-xs uppercase tracking-wider font-bold text-[var(--text-faint)] whitespace-nowrap';
  const cell = 'px-3 py-2 text-sm leading-snug break-words align-top';

  const pubNombre = pub.titulo || '—';
  const pubMarca = pub.brand || '—';
  const pubModeloSku = pub.sku || pub.model || '—';
  const pubCodigo = pub.codigo || '—';
  const sugNombre = sug.nombre;
  const sugMarca = sug.marca || '—';
  const sugModelo = sug.modelo || '—';
  const sugCodigo = sug.codigo_universal || '—';

  return (
    <div className="rounded-md border border-[var(--border)] overflow-hidden bg-[var(--surface-2)]/40">
      {/* Escritorio: columnas = campos comparables */}
      <div className="hidden md:grid grid-cols-[64px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className={th}></div>
        <div className={th}>Nombre</div>
        <div className={th}>Marca</div>
        <div className={th}>Modelo/SKU</div>
        <div className={th}>Código</div>

        <div className={rowLabel}>Vitrina</div>
        <div className={cell + ' text-[var(--text)]'}>{pubNombre}</div>
        <div className={cell + ' text-[var(--text)]'}>{pubMarca}</div>
        <div className={cell + ' font-mono text-[var(--text)]'}>{pubModeloSku}</div>
        <div className={cell + ' font-mono text-[var(--text)]'}>{pubCodigo}</div>

        <div className={rowLabel}>Sugerido</div>
        <div className={cell + ' font-semibold text-[var(--ok)]'}>{sugNombre}</div>
        <div className={cell + ' text-[var(--ok)]'}>{sugMarca}</div>
        <div className={cell + ' font-mono text-[var(--ok)]'}>{sugModelo}</div>
        <div className={cell + ' font-mono text-[var(--ok)]'}>{sugCodigo}</div>
      </div>

      {/* Móvil: apilado, campo por campo */}
      <div className="md:hidden divide-y divide-[var(--border)] break-words">
        <div className="px-3 py-2.5">
          <div className="text-xs uppercase tracking-wider font-bold text-[var(--text-faint)] mb-1">Nombre</div>
          <div className="text-sm text-[var(--text)] leading-snug"><span className="font-semibold text-[var(--text-faint)]">Vitrina: </span>{pubNombre}</div>
          <div className="text-sm text-[var(--ok)] leading-snug font-semibold"><span className="font-semibold text-[var(--text-faint)]">Sugerido: </span>{sugNombre}</div>
        </div>
        <div className="px-3 py-2.5">
          <div className="text-xs uppercase tracking-wider font-bold text-[var(--text-faint)] mb-1">Marca</div>
          <div className="text-sm text-[var(--text)] leading-snug"><span className="font-semibold text-[var(--text-faint)]">Vitrina: </span>{pubMarca}</div>
          <div className="text-sm text-[var(--ok)] leading-snug font-semibold"><span className="font-semibold text-[var(--text-faint)]">Sugerido: </span>{sugMarca}</div>
        </div>
        <div className="px-3 py-2.5">
          <div className="text-xs uppercase tracking-wider font-bold text-[var(--text-faint)] mb-1">Modelo / SKU</div>
          <div className="text-sm text-[var(--text)] leading-snug font-mono"><span className="font-semibold text-[var(--text-faint)]">Vitrina: </span>{pubModeloSku}</div>
          <div className="text-sm text-[var(--ok)] leading-snug font-semibold font-mono"><span className="font-semibold text-[var(--text-faint)]">Sugerido: </span>{sugModelo}</div>
        </div>
        <div className="px-3 py-2.5">
          <div className="text-xs uppercase tracking-wider font-bold text-[var(--text-faint)] mb-1">Código</div>
          <div className="text-sm text-[var(--text)] leading-snug font-mono"><span className="font-semibold text-[var(--text-faint)]">Vitrina: </span>{pubCodigo}</div>
          <div className="text-sm text-[var(--ok)] leading-snug font-semibold font-mono"><span className="font-semibold text-[var(--text-faint)]">Sugerido: </span>{sugCodigo}</div>
        </div>
      </div>

      {(sug.variante || sug.caja_madre) && (
        <div className="px-3 py-2 text-sm border-t border-[var(--border)] space-y-0.5">
          {sug.variante && (
            <div className="text-[var(--info)] font-semibold">Variante (sugerido): {sug.variante}</div>
          )}
          {sug.caja_madre && (
            <div className="text-[var(--warn)] font-semibold">Caja madre (sugerido): {sug.caja_madre}</div>
          )}
        </div>
      )}
    </div>
  );
}
