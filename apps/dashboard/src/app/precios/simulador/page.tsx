'use client';
import { useState } from 'react';
import { AutocompleteArticulo } from '@/components/AutocompleteArticulo';
import { AutocompleteRegla } from '@/components/AutocompleteRegla';

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
        <div className="p-8 h-screen bg-[var(--bg)]">
            <h1 className="text-2xl font-bold mb-6 text-[var(--text)]">Simulador de Precio Final</h1>
            
            <div className="bg-[var(--surface)] p-6 rounded-lg shadow max-w-2xl">
                <div className="flex flex-col space-y-4 mb-6">
                    <div>
                        <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Artículo</label>
                        <AutocompleteArticulo value={articuloId} onChange={setArticuloId} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Regla de Pricing</label>
                        <AutocompleteRegla value={reglaId} onChange={setReglaId} />
                    </div>
                    <button 
                        className="bg-[var(--accent)] hover:brightness-110 text-[var(--accent-ink)] p-2 rounded font-medium shadow-sm transition-colors disabled:opacity-50" 
                        onClick={simular}
                        disabled={loading || !articuloId || !reglaId}
                    >
                        {loading ? 'Calculando...' : 'Simular Cálculo Inverso'}
                    </button>
                </div>

                {resultado && (
                    <div className="bg-[var(--surface-2)] p-4 rounded-lg text-[var(--ok)] overflow-x-auto shadow-inner">
                        <pre className="text-sm font-mono">{JSON.stringify(resultado, null, 2)}</pre>
                    </div>
                )}
            </div>
        </div>
    );
}
