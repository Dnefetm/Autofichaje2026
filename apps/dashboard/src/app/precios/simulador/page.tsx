'use client';
import { useState } from 'react';

export default function SimuladorPage() {
    const [articuloId, setArticuloId] = useState('');
    const [reglaId, setReglaId] = useState('');
    const [resultado, setResultado] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    const simular = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/precios/simular?articulo_id=${articuloId}&regla_id=${reglaId}`);
            const data = await res.json();
            setResultado(data);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-8 h-screen bg-slate-50">
            <h1 className="text-2xl font-bold mb-6 text-slate-900">Simulador de Precio Final</h1>
            
            <div className="bg-white p-6 rounded-lg shadow max-w-2xl">
                <div className="flex flex-col space-y-4 mb-6">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">UUID del Artículo</label>
                        <input className="border border-slate-300 p-2 w-full rounded focus:ring-indigo-500 focus:border-indigo-500" value={articuloId} onChange={e=>setArticuloId(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">UUID de la Regla</label>
                        <input className="border border-slate-300 p-2 w-full rounded focus:ring-indigo-500 focus:border-indigo-500" value={reglaId} onChange={e=>setReglaId(e.target.value)} />
                    </div>
                    <button 
                        className="bg-indigo-600 hover:bg-indigo-700 text-white p-2 rounded font-medium shadow-sm transition-colors disabled:opacity-50" 
                        onClick={simular}
                        disabled={loading || !articuloId || !reglaId}
                    >
                        {loading ? 'Calculando...' : 'Simular Cálculo Inverso'}
                    </button>
                </div>

                {resultado && (
                    <div className="bg-slate-900 p-4 rounded-lg text-green-400 overflow-x-auto shadow-inner">
                        <pre className="text-sm font-mono">{JSON.stringify(resultado, null, 2)}</pre>
                    </div>
                )}
            </div>
        </div>
    );
}
