'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function ProveedorTabs({ proveedor, importacionId }: { proveedor: string; importacionId?: string | null }) {
    const pathname = usePathname();
    const base = `/precios/${encodeURIComponent(proveedor)}`;

    const tabs = [
        { label: 'Lista', href: base, match: (p: string) => p === base },
        { label: 'Importar', href: `${base}/subir`, match: (p: string) => p.startsWith(`${base}/subir`) || p.startsWith(`${base}/mapear`) || p.startsWith(`${base}/matching`) },
        { label: 'Historial', href: `${base}/historial`, match: (p: string) => p.startsWith(`${base}/historial`) && !p.includes('/vinculacion') && !p.includes('/resumen') },
        { label: 'Vinculación', href: importacionId ? `${base}/historial/${importacionId}/vinculacion` : `${base}/historial`, match: (p: string) => p.includes('/vinculacion') },
        { label: 'Reglas', href: `${base}/reglas`, match: (p: string) => p.startsWith(`${base}/reglas`) },
    ];

    return (
        <nav className="flex gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface)] px-4 md:px-6">
            {tabs.map((t) => {
                const active = t.match(pathname);
                return (
                    <Link
                        key={t.label}
                        href={t.href}
                        className={`shrink-0 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
                            active
                                ? 'border-[var(--accent)] text-[var(--accent)]'
                                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
                        }`}
                    >
                        {t.label}
                    </Link>
                );
            })}
        </nav>
    );
}
