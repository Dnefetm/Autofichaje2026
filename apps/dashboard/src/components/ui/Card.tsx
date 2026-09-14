import { cn } from '@/lib/utils';

export function Card({
  title,
  children,
  className,
}: {
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-sm overflow-hidden', className)}>
      {title != null && (
        <div className="px-4 py-3 border-b border-[var(--border)] text-sm font-semibold text-[var(--text)]">{title}</div>
      )}
      {children}
    </div>
  );
}
