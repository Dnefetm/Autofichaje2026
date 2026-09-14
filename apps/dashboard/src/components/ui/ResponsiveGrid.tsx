import { cn } from '@/lib/utils';

type Cols = 2 | 3 | 4;

const colsDesktop: Record<Cols, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
};

const gaps = {
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  5: 'gap-5',
  6: 'gap-6',
} as const;

export function ResponsiveGrid({
  cols = 2,
  gap = 4,
  children,
  className,
}: {
  cols?: Cols;
  gap?: keyof typeof gaps;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-1', colsDesktop[cols], gaps[gap], className)}>
      {children}
    </div>
  );
}
