"use client";

import { useState } from 'react';
import { Unlink, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function DesvincularBtn({ proveedor, articuloId }: { proveedor: string; articuloId: string }) {
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    async function handleDesvincular() {
        if (!confirm("¿Seguro que deseas desvincular este artículo del catálogo? Volverá a la bandeja de importación pendiente.")) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/precios/proveedor/${encodeURIComponent(proveedor)}/desvincular`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ articulo_id: articuloId })
            });
            const data = await res.json();
            if (!data.ok) {
                alert(data.error || "Error al desvincular");
            } else {
                router.refresh();
            }
        } catch (e: any) {
            alert(e.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <button 
            onClick={handleDesvincular}
            disabled={loading}
            className="inline-flex items-center justify-center w-8 h-8 rounded hover:bg-[var(--err)]/10 text-[var(--text-faint)] hover:text-[var(--err)] transition-colors"
            title="Desvincular del Catálogo Maestro"
        >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
        </button>
    );
}
