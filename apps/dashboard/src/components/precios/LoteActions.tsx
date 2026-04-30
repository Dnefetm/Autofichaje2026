'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';

export function LoteActions({ importacion, proveedor }: { importacion: any, proveedor: string }) {
    const [restoring, setRestoring] = useState(false);
    const router = useRouter();

    const handleRestore = async () => {
        setRestoring(true);
        try {
            const res = await fetch('/api/precios/restaurar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ importacion_id: importacion.id })
            });
            if (res.ok) {
                alert('Lote restaurado como vigente.');
                router.refresh();
            } else {
                const data = await res.json();
                alert(`Error: ${data.error}`);
            }
        } catch (e) {
            alert('Error de red');
        } finally {
            setRestoring(false);
        }
    };

    return (
        <div className="flex space-x-2">
            {!importacion.vigente && importacion.estado !== 'pendiente' && (
                <button 
                    onClick={handleRestore}
                    disabled={restoring}
                    className="inline-flex items-center px-4 py-2 bg-white border border-indigo-200 rounded-md font-medium text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300 shadow-sm text-sm transition-colors disabled:opacity-50"
                >
                    {restoring ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Restaurar lote anterior
                </button>
            )}
            
            <Link 
                href={`/precios/${encodeURIComponent(proveedor)}/historial/${importacion.id}/confirmar`}
                className="inline-flex items-center px-4 py-2 bg-indigo-600 border border-transparent rounded-md font-medium text-white hover:bg-indigo-700 shadow-sm text-sm transition-colors"
            >
                Confirmar Precios
            </Link>
        </div>
    );
}
