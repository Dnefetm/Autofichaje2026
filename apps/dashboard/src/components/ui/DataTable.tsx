'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  render?: (row: T) => React.ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = 'Sin datos',
  loading = false,
  className,
  rowClassName,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: React.ReactNode;
  loading?: boolean;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
}) {
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

  return (
    <div className={cn('overflow-x-auto', className)}>
      {/* Escritorio: tabla */}
      <table className="w-full text-left text-sm hidden md:table">
        <thead className="bg-[var(--bg)] text-[var(--text-muted)] border-b border-[var(--border)]">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cn('px-4 py-3 font-semibold text-xs uppercase tracking-wider', c.align === 'right' && 'text-right')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((row) => (
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
        {rows.map((row) => (
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
