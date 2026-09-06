'use client';
import { toast } from 'sonner';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';

export function ProveedorRenombrarButton({ proveedor }: { proveedor: string }) {
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handle = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const nuevo = prompt('Nuevo nombre del proveedor:', proveedor);
        if (!nuevo || nuevo.trim() === '' || nuevo.trim() === proveedor) return;

        setLoading(true);
        try {
            const res = await fetch('/api/precios/proveedores/renombrar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ viejo: proveedor, nuevo: nuevo.trim() })
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                toast.error(data?.error || 'No se pudo renombrar el proveedor.');
                return;
            }
            router.refresh();
        } finally {
            setLoading(false);
        }
    };

    return (
        <button
            onClick={handle}
            disabled={loading}
            title="Renombrar proveedor"
            className="absolute top-2 right-10 z-20 p-1.5 rounded-lg bg-[var(--surface)]/80 border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg)] transition-colors"
        >
            <Pencil className="w-4 h-4" />
        </button>
    );
}
