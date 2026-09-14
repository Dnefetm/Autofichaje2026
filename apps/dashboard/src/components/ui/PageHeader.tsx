export function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text)]">{title}</h1>
        {description != null && <p className="text-[var(--text-muted)] text-sm mt-0.5">{description}</p>}
      </div>
      {actions != null && (
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">{actions}</div>
      )}
    </div>
  );
}
