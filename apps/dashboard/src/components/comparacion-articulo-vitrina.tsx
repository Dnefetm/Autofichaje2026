"use client";
import React from 'react';

/**
 * Comparación alineada INVERSA: artículo (catálogo maestro, fijo) contra la
 * vidriera (publicación) sugerida. Espejo de `SugerenciaComparacion`, pero con
 * el artículo arriba y la vidriera abajo.
 * - Escritorio (md+): columnas = campos; renglón superior = Artículo, inferior = Vidriera.
 * - Móvil (<md): apilado, campo por campo.
 */
export interface ComparacionArticuloVitrinaProps {
  articulo: {
    nombre: string;
    marca?: string | null;
    modelo?: string | null;
    articulo_id?: string | null;
    codigo_universal?: string | null;
    caja_madre?: string | null;
  };
  vitrina: {
    titulo?: string | null;
    brand?: string | null;
    model?: string | null;
    seller_sku?: string | null;
    codigo?: string | null; // ean / gtin / upc
  };
}

export default function ComparacionArticuloVitrina({ articulo, vitrina }: ComparacionArticuloVitrinaProps) {
  const th = 'px-3 py-1.5 text-xs uppercase tracking-wider font-bold text-[var(--text-faint)]';
  const rowLabel = 'px-3 py-2 text-xs uppercase tracking-wider font-bold text-[var(--text-faint)] whitespace-nowrap';
  const cell = 'px-3 py-2 text-sm leading-snug break-words align-top';

  const artNombre = articulo.nombre || '—';
  const artMarca = articulo.marca || '—';
  const artModeloSku = articulo.modelo || articulo.articulo_id || '—';
  const artCodigo = articulo.codigo_universal || '—';
  const vitNombre = vitrina.titulo || '—';
  const vitMarca = vitrina.brand || '—';
  const vitModeloSku = vitrina.seller_sku || vitrina.model || '—';
  const vitCodigo = vitrina.codigo || '—';

  return (
    <div className="rounded-md border border-[var(--border)] overflow-hidden bg-[var(--surface-2)]/40">
      <div className="hidden md:grid grid-cols-[64px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className={th}></div>
        <div className={th}>Nombre</div>
        <div className={th}>Marca</div>
        <div className={th}>Modelo/SKU</div>
        <div className={th}>Código</div>

        <div className={rowLabel}>Artículo</div>
        <div className={cell + ' font-semibold text-[var(--ok)]'}>{artNombre}</div>
        <div className={cell + ' text-[var(--ok)]'}>{artMarca}</div>
        <div className={cell + ' font-mono text-[var(--ok)]'}>{artModeloSku}</div>
        <div className={cell + ' font-mono text-[var(--ok)]'}>{artCodigo}</div>

        <div className={rowLabel}>Vidriera</div>
        <div className={cell + ' text-[var(--text)]'}>{vitNombre}</div>
        <div className={cell + ' text-[var(--text)]'}>{vitMarca}</div>
        <div className={cell + ' font-mono text-[var(--text)]'}>{vitModeloSku}</div>
        <div className={cell + ' font-mono text-[var(--text)]'}>{vitCodigo}</div>
      </div>

      <div className="md:hidden divide-y divide-[var(--border)] break-words">
        <div className="px-3 py-2.5">
          <div className="text-xs uppercase tracking-wider font-bold text-[var(--text-faint)] mb-1">Nombre</div>
          <div className="text-sm text-[var(--ok)] leading-snug font-semibold"><span className="font-semibold text-[var(--text-faint)]">Artículo: </span>{artNombre}</div>
          <div className="text-sm text-[var(--text)] leading-snug"><span className="font-semibold text-[var(--text-faint)]">Vidriera: </span>{vitNombre}</div>
        </div>
        <div className="px-3 py-2.5">
          <div className="text-xs uppercase tracking-wider font-bold text-[var(--text-faint)] mb-1">Marca</div>
          <div className="text-sm text-[var(--ok)] leading-snug font-semibold"><span className="font-semibold text-[var(--text-faint)]">Artículo: </span>{artMarca}</div>
          <div className="text-sm text-[var(--text)] leading-snug"><span className="font-semibold text-[var(--text-faint)]">Vidriera: </span>{vitMarca}</div>
        </div>
        <div className="px-3 py-2.5">
          <div className="text-xs uppercase tracking-wider font-bold text-[var(--text-faint)] mb-1">Modelo / SKU</div>
          <div className="text-sm text-[var(--ok)] leading-snug font-semibold font-mono"><span className="font-semibold text-[var(--text-faint)]">Artículo: </span>{artModeloSku}</div>
          <div className="text-sm text-[var(--text)] leading-snug font-mono"><span className="font-semibold text-[var(--text-faint)]">Vidriera: </span>{vitModeloSku}</div>
        </div>
        <div className="px-3 py-2.5">
          <div className="text-xs uppercase tracking-wider font-bold text-[var(--text-faint)] mb-1">Código</div>
          <div className="text-sm text-[var(--ok)] leading-snug font-semibold font-mono"><span className="font-semibold text-[var(--text-faint)]">Artículo: </span>{artCodigo}</div>
          <div className="text-sm text-[var(--text)] leading-snug font-mono"><span className="font-semibold text-[var(--text-faint)]">Vidriera: </span>{vitCodigo}</div>
        </div>
      </div>

      {articulo.caja_madre && (
        <div className="px-3 py-2 text-sm border-t border-[var(--border)] text-[var(--warn)] font-semibold">
          Caja madre (artículo): {articulo.caja_madre}
        </div>
      )}
    </div>
  );
}
