'use client';
import { useState } from 'react';

export function PendienteVincularRow({ pendiente }: { pendiente: any }) {
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
                window.location.reload();
            } else {
                alert('Error al vincular');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <tr className="hover:bg-slate-50 transition-colors">
            <td className="px-4 py-3 font-mono text-slate-700">{pendiente.codigo_excel}</td>
            <td className="px-4 py-3">
                <div className="font-medium">{pendiente.marca_excel}</div>
                <div className="text-slate-500">{pendiente.modelo_excel}</div>
            </td>
            <td className="px-4 py-3 font-medium text-slate-900">
                {Number(pendiente.valor).toLocaleString()} {pendiente.moneda}
            </td>
            <td className="px-4 py-3">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${pendiente.motivo === 'ambiguo' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                    {pendiente.motivo}
                </span>
            </td>
            <td className="px-4 py-3 flex space-x-2">
                <input 
                    type="text" 
                    placeholder="UUID del artículo" 
                    value={articuloId} 
                    onChange={e => setArticuloId(e.target.value)}
                    className="border-slate-300 rounded-md text-sm shadow-sm focus:ring-indigo-500 focus:border-indigo-500 w-full px-2 py-1 border"
                />
                <button 
                    onClick={handleVincular} 
                    disabled={loading || !articuloId}
                    className="bg-indigo-600 text-white px-3 py-1 rounded text-sm disabled:opacity-50 whitespace-nowrap"
                >
                    {loading ? '...' : 'Vincular'}
                </button>
            </td>
        </tr>
    );
}
