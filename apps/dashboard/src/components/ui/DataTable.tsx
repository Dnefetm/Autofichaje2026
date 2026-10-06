'use client';

import { useMemo, useState } from 'react';
import { Loader2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  render?: (row: T) => React.ReactNode;
  sortValue?: (row: T) => number | string | null | undefined;
  /** Etiqueta de agrupación: las columnas contiguas con el mismo group comparten cabecera. */
  group?: string;
  /** Ancho fijo (ej. '64px'). La columna sin width absorbe el espacio restante. */
  width?: string;
  /** Evita el salto de línea del contenido de la celda. */
  nowrap?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = 'Sin datos',
  loading = false,
  className,
  rowClassName,
  sortable = false,
  initialSort,
  dense = false,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: React.ReactNode;
  loading?: boolean;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
  sortable?: boolean;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  dense?: boolean;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const { key, dir } = sort;
    const col = columns.find(c => c.key === key);
    const getVal = (r: T) => (col?.sortValue ? col.sortValue(r) : ((r as Record<string, unknown>)[key] as any));
    return [...rows].sort((a, b) => {
      const va = getVal(a);
      const vb = getVal(b);
      const na = va == null ? '' : va;
      const nb = vb == null ? '' : vb;
      let cmp: number;
      if (typeof na === 'number' && typeof nb === 'number') cmp = na - nb;
      else cmp = String(na).localeCompare(String(nb), 'es', { numeric: true });
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort, columns]);

  if (loading) {
    return (
      <div className="px-6 py-12 text-center text-[var(--text-faint)]">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-[var(--accent)]" />
        Cargando…
      </div>
    );
  }
  if (rows.length === 0) {
    return <div className="px-6 py-12 text-center text-[var(--text-faint)]">{empty}</div>;
  }

  const value = (row: T, c: Column<T>): React.ReactNode =>
    c.render ? c.render(row) : ((row as Record<string, unknown>)[c.key] as React.ReactNode);

  const toggleSort = (key: string) => {
    setSort(prev => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  };

  const headerCell = (c: Column<T>) => {
    const isSorted = sort?.key === c.key;
    const Icon = !isSorted ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
    if (!sortable) return <span>{c.label}</span>;
    return (
      <button
        type="button"
        onClick={() => toggleSort(c.key)}
        className={cn('inline-flex items-center gap-1 uppercase tracking-wider font-semibold hover:text-[var(--text)] transition-colors', c.align === 'right' && 'flex-row-reverse')}
      >
        {c.label}
        <Icon className={cn('w-3 h-3', isSorted ? 'text-[var(--accent)]' : 'opacity-40')} />
      </button>
    );
  };

  const hasGroups = columns.some(c => c.group);
  const useFixed = columns.some(c => c.width);
  const cellPad = dense ? 'px-2 py-2' : 'px-4 py-3';
  const headPad = dense ? 'px-2 py-1.5' : 'px-4 py-3';

  // Cabecera agrupada (dos filas): grupos con colSpan + columnas sueltas con rowSpan.
  const groupCells: React.ReactNode[] = [];
  const subCells: React.ReactNode[] = [];
  if (hasGroups) {
    let i = 0;
    while (i < columns.length) {
      const c = columns[i];
      if (c.group) {
        let j = i;
        while (j < columns.length && columns[j].group === c.group) j++;
        groupCells.push(
          <th key={`g-${i}`} colSpan={j - i} className="px-2 py-1.5 text-center text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)] border-x border-b border-[var(--border)] bg-[var(--surface-2)]">
            {c.group}
          </th>
        );
        for (let k = i; k < j; k++) {
          const ck = columns[k];
          subCells.push(
            <th key={ck.key} className={cn(headPad, 'text-xs', ck.align === 'right' && 'text-right')} style={ck.width ? { width: ck.width } : undefined}>
              {headerCell(ck)}
            </th>
          );
        }
        i = j;
      } else {
        groupCells.push(
          <th key={`u-${i}`} rowSpan={2} className={cn(headPad, 'text-xs align-middle', c.align === 'right' && 'text-right')}>
            {headerCell(c)}
          </th>
        );
        i++;
      }
    }
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      {/* Escritorio: tabla */}
      <table className={cn('w-full text-left text-sm hidden md:table', useFixed && 'table-fixed')}>
        {useFixed && (
          <colgroup>
            {columns.map((c, i) => (
              <col key={i} style={c.width ? { width: c.width } : undefined} />
            ))}
          </colgroup>
        )}
        <thead className="bg-[var(--bg)] text-[var(--text-muted)] border-b border-[var(--border)]">
          {hasGroups && (
            <tr>
              {groupCells}
            </tr>
          )}
          <tr>
            {hasGroups
              ? subCells
              : columns.map((c) => (
                  <th key={c.key} className={cn(headPad, 'text-xs', c.align === 'right' && 'text-right')}>
                    {headerCell(c)}
                  </th>
                ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {sorted.map((row) => (
            <tr key={rowKey(row)} className={rowClassName?.(row)}>
              {columns.map((c) => (
                <td key={c.key} className={cn(cellPad, 'align-middle', c.align === 'right' && 'text-right', c.nowrap && 'whitespace-nowrap')}>
                  {value(row, c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Móvil: cards apiladas */}
      <div className="md:hidden divide-y divide-[var(--border)]">
        {sorted.map((row) => (
          <div key={rowKey(row)} className={cn('px-4 py-3 space-y-1.5', rowClassName?.(row))}>
            {columns.map((c) => (
              <div key={c.key} className="flex items-start justify-between gap-3">
                <span className="text-xs text-[var(--text-faint)] uppercase tracking-wider shrink-0 pt-0.5">{c.label}</span>
                <span className="text-sm text-[var(--text)] text-right min-w-0 break-words">{value(row, c)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
