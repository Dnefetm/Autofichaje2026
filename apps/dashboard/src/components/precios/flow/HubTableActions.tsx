'use client';
import { useState } from 'react';
import { RefreshCw, Download, Loader2 } from 'lucide-react';

export function HubTableActions({ proveedor, count }: { proveedor: string, count: number }) {
    const [recalculating, setRecalculating] = useState(false);
    const [batchStatus, setBatchStatus] = useState<any>(null); // In a real app we'd poll

    const handleRecalculateAll = async () => {
        if (!confirm(`¿Estás seguro de encolar el recálculo de ${count} artículos?`)) return;
        setRecalculating(true);
        try {
            // Mock call to API
            const res = await fetch('/api/precios/recalcular-masivo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ proveedor })
            });
            if (res.ok) {
                const data = await res.json();
                setBatchStatus(data);
                alert(`${data.enqueued} publicaciones encoladas. Procesando en segundo plano.`);
            } else {
                alert('Error al encolar.');
            }
        } catch (e) {
            alert('Error de red');
        } finally {
            setRecalculating(false);
        }
    };

    return (
        <div className="flex items-center space-x-3">
            <button 
                onClick={handleRecalculateAll}
                disabled={recalculating || count === 0}
                className="inline-flex items-center px-4 py-2 bg-[var(--surface)] border border-slate-300 rounded-md font-medium text-[var(--text-muted)] hover:bg-[var(--bg)] shadow-sm text-sm transition-colors disabled:opacity-50"
            >
                {recalculating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Recalcular todos
            </button>
            <button 
                disabled={count === 0}
                className="inline-flex items-center px-4 py-2 bg-[var(--surface)] border border-slate-300 rounded-md font-medium text-[var(--text-muted)] hover:bg-[var(--bg)] shadow-sm text-sm transition-colors disabled:opacity-50"
            >
                <Download className="w-4 h-4 mr-2" />
                Exportar lista activa
            </button>
        </div>
    );
}
