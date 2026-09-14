import { cn } from '@/lib/utils';

export function FormField({
  label,
  hint,
  error,
  children,
  className,
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      {label != null && <label className="text-xs text-[var(--text-muted)] block">{label}</label>}
      {children}
      {hint != null && <p className="text-xs text-[var(--text-faint)]">{hint}</p>}
      {error != null && <p className="text-xs text-[var(--err)]">{error}</p>}
    </div>
  );
}
