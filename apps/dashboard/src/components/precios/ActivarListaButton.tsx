'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle2 } from 'lucide-react';

export function ActivarListaButton({ importacionId, proveedor }: { importacionId: string; proveedor: string }) {
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);
    const router = useRouter();

    const handleActivar = async () => {
        if (!confirm(`¿Confirmas activar este lote como la lista de precios vigente de ${proveedor}?\n\nLa lista anterior quedará desactivada automáticamente.`)) return;

        setLoading(true);
        try {
            const res = await fetch(`/api/precios/importar/${importacionId}/activar`, {
                method: 'POST'
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                setDone(true);
                setTimeout(() => {
                    router.push(`/precios/${encodeURIComponent(proveedor)}`);
                }, 1500);
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (e) {
            alert('Error de red');
        } finally {
            setLoading(false);
        }
    };

    if (done) {
        return (
            <div className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-100 text-emerald-700 rounded-xl font-bold text-sm">
                <CheckCircle2 className="w-5 h-5" />
                ¡Lista activada! Redirigiendo...
            </div>
        );
    }

    return (
        <button
            onClick={handleActivar}
            disabled={loading}
            className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm shadow-sm transition-all disabled:opacity-60"
        >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Activar como Lista Vigente
        </button>
    );
}
