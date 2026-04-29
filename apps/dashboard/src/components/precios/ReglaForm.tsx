'use client';
import { useState } from 'react';

export function ReglaForm() {
    const [nombre, setNombre] = useState('');
    const [canal, setCanal] = useState('mercadolibre');
    const [margen, setMargen] = useState(0);
    const [fijos, setFijos] = useState(0);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        const res = await fetch('/api/precios/reglas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre, canal, margen_pct: margen, costos_fijos: fijos })
        });
        setLoading(false);
        if(res.ok) window.location.reload();
    };

    return (
        <form onSubmit={handleSubmit} className="flex flex-col space-y-4 max-w-md">
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nombre de Regla</label>
                <input className="border border-slate-300 w-full p-2 rounded shadow-sm focus:ring-indigo-500 focus:border-indigo-500" placeholder="Ej. Margen Seguro 20%" value={nombre} onChange={e=>setNombre(e.target.value)} required />
            </div>
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Canal de Venta</label>
                <select className="border border-slate-300 w-full p-2 rounded shadow-sm focus:ring-indigo-500 focus:border-indigo-500" value={canal} onChange={e=>setCanal(e.target.value)}>
                    <option value="mercadolibre">Mercado Libre</option>
                    <option value="shopify">Shopify</option>
                </select>
            </div>
            <div className="flex space-x-4">
                <div className="flex-1">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Margen %</label>
                    <input className="border border-slate-300 w-full p-2 rounded shadow-sm focus:ring-indigo-500 focus:border-indigo-500" type="number" step="0.01" value={margen} onChange={e=>setMargen(Number(e.target.value))} />
                </div>
                <div className="flex-1">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Costos Fijos Extra</label>
                    <input className="border border-slate-300 w-full p-2 rounded shadow-sm focus:ring-indigo-500 focus:border-indigo-500" type="number" step="0.01" value={fijos} onChange={e=>setFijos(Number(e.target.value))} />
                </div>
            </div>
            <button disabled={loading} className="bg-indigo-600 text-white p-2 rounded font-medium shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {loading ? 'Guardando...' : 'Guardar Regla'}
            </button>
        </form>
    );
}
