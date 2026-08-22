'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react';

export function HubRowActions({ articuloId, proveedor, estadoActualizacion }: { articuloId: string, proveedor: string, estadoActualizacion: string }) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);

    const handleAction = async (accion: 'confirmado_vigente' | 'marcado_descontinuado') => {
        setLoading(true);
        try {
            const res = await fetch(`/api/precios/revision-manual`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    proveedor,
                    articulo_id: articuloId,
                    accion
                })
            });
            if (!res.ok) {
                const data = await res.json();
                alert(data.error || 'Error al guardar revisión');
            } else {
                // Ideally refresh the data, or just show a success toast.
                router.refresh();
            }
        } catch (e: any) {
            alert('Error de red');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex items-center justify-center space-x-2">
            {estadoActualizacion === 'desactualizado' && (
                <button 
                    onClick={() => handleAction('confirmado_vigente')}
                    disabled={loading}
                    className="p-1.5 text-[var(--text-faint)] hover:text-[var(--ok)] hover:bg-[var(--ok)]/10 rounded transition-colors disabled:opacity-50" 
                    title="Confirmar vigente manualmente"
                >
                    <CheckCircle className="w-4 h-4" />
                </button>
            )}
            
            {estadoActualizacion !== 'posiblemente_descontinuado' && (
                <button 
                    onClick={() => handleAction('marcado_descontinuado')}
                    disabled={loading}
                    className="p-1.5 text-[var(--text-faint)] hover:text-[var(--err)] hover:bg-[var(--err)]/10 rounded transition-colors disabled:opacity-50" 
                    title="Marcar como descontinuado"
                >
                    <XCircle className="w-4 h-4" />
                </button>
            )}

            <button className="p-1.5 text-[var(--text-faint)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 rounded transition-colors" title="Recalcular precio de publicación">
                <RefreshCw className="w-4 h-4" />
            </button>
        </div>
    );
}
