'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AutocompleteArticulo } from '@/components/AutocompleteArticulo';

export function PendienteVincularRow({ pendiente }: { pendiente: any }) {
    const router = useRouter();
    const [articuloId, setArticuloId] = useState('');
    const [loading, setLoading] = useState(false);

    const handleVincular = async () => {
        if (!articuloId) return;
        setLoading(true);
        try {
            const res = await fetch('/api/precios/vincular-pendiente', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pendiente_id: pendiente.id,
                    articulo_id: articuloId,
                    proveedor: pendiente.proveedor,
                    codigo_excel: pendiente.codigo_excel,
                    marca_excel: pendiente.marca_excel,
                    modelo_excel: pendiente.modelo_excel
                })
            });
            if (res.ok) {
                router.refresh();
            } else {
                alert('Error al vincular');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <tr className="hover:bg-[var(--bg)] transition-colors">
            <td className="px-4 py-3 font-mono text-[var(--text-muted)]">{pendiente.codigo_excel}</td>
            <td className="px-4 py-3">
                <div className="font-medium">{pendiente.marca_excel}</div>
                <div className="text-[var(--text-muted)]">{pendiente.modelo_excel}</div>
            </td>
            <td className="px-4 py-3 font-medium text-[var(--text)]">
                {Number(pendiente.valor).toLocaleString()} {pendiente.moneda}
            </td>

            <td className="px-4 py-3 flex space-x-2">
                <div className="w-64">
                    <AutocompleteArticulo 
                        value={articuloId} 
                        onChange={setArticuloId} 
                    />
                </div>
                <button 
                    onClick={handleVincular} 
                    disabled={loading || !articuloId}
                    className="bg-[var(--accent)] text-[var(--accent-ink)] px-3 py-1 rounded text-sm disabled:opacity-50 whitespace-nowrap"
                >
                    {loading ? '...' : 'Vincular'}
                </button>
            </td>
        </tr>
    );
}
