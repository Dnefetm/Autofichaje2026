'use client';

import { useState } from 'react';
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react';

export function HubRowActions({ articuloId, proveedor, estadoActualizacion }: { articuloId: string, proveedor: string, estadoActualizacion: string }) {
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
                window.location.reload();
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
                    className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors disabled:opacity-50" 
                    title="Confirmar vigente manualmente"
                >
                    <CheckCircle className="w-4 h-4" />
                </button>
            )}
            
            {estadoActualizacion !== 'posiblemente_descontinuado' && (
                <button 
                    onClick={() => handleAction('marcado_descontinuado')}
                    disabled={loading}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors disabled:opacity-50" 
                    title="Marcar como descontinuado"
                >
                    <XCircle className="w-4 h-4" />
                </button>
            )}

            <button className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors" title="Recalcular precio de publicación">
                <RefreshCw className="w-4 h-4" />
            </button>
        </div>
    );
}
