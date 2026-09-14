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
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">{title}</h1>
        {description != null && <p className="text-[var(--text-muted)] text-sm mt-0.5">{description}</p>}
      </div>
      {actions != null && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}
