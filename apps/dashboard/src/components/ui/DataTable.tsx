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

  return (
    <div className={cn('overflow-x-auto', className)}>
      {/* Escritorio: tabla */}
      <table className="w-full text-left text-sm hidden md:table">
        <thead className="bg-[var(--bg)] text-[var(--text-muted)] border-b border-[var(--border)]">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cn('px-4 py-3 text-xs', c.align === 'right' && 'text-right')}>
                {headerCell(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {sorted.map((row) => (
            <tr key={rowKey(row)} className={rowClassName?.(row)}>
              {columns.map((c) => (
                <td key={c.key} className={cn('px-4 py-3 align-middle', c.align === 'right' && 'text-right')}>
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
