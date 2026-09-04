'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore } from 'lucide-react';

export function ProveedorArchivarButton({ proveedor, archivado }: { proveedor: string; archivado: boolean }) {
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handle = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setLoading(true);
        try {
            const res = await fetch('/api/precios/proveedores', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre: proveedor, archivado: !archivado })
            });
            if (res.ok) router.refresh();
        } finally {
            setLoading(false);
        }
    };

    return (
        <button
            onClick={handle}
            disabled={loading}
            title={archivado ? 'Desarchivar proveedor' : 'Archivar proveedor'}
            className="absolute top-2 right-2 z-20 p-1.5 rounded-lg bg-[var(--surface)]/80 border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--err)] hover:bg-[var(--bg)] transition-colors"
        >
            {archivado ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
        </button>
    );
}
