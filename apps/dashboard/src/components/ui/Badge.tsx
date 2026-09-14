import { cn } from '@/lib/utils';

type Tone = 'success' | 'warning' | 'info' | 'neutral' | 'danger';

const tones: Record<Tone, string> = {
  success: 'bg-[var(--ok)]/15 text-[var(--ok)]',
  warning: 'bg-[var(--warn)]/15 text-[var(--warn)]',
  info: 'bg-[var(--info)]/15 text-[var(--info)]',
  neutral: 'bg-[var(--surface-2)] text-[var(--text-muted)]',
  danger: 'bg-[var(--err)]/15 text-[var(--err)]',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  );
}
