'use client';
import { useState, useEffect, useRef } from 'react';

export function AutocompleteRegla({ 
    value, 
    onChange 
}: { 
    value: string; 
    onChange: (id: string) => void;
}) {
    const [reglas, setReglas] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedName, setSelectedName] = useState('');

    useEffect(() => {
        const fetchReglas = async () => {
            setLoading(true);
            try {
                const res = await fetch('/api/precios/reglas/list');
                if (res.ok) {
                    const data = await res.json();
                    setReglas(data.reglas || []);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchReglas();
    }, []);

    return (
        <div className="relative w-full">
            <select 
                value={value}
                onChange={e => onChange(e.target.value)}
                className="border-slate-300 rounded-md text-sm shadow-sm focus:ring-indigo-500 focus:border-indigo-500 w-full px-3 py-2 border bg-white"
            >
                <option value="">-- Seleccionar Regla --</option>
                {reglas.map(r => (
                    <option key={r.id} value={r.id}>
                        [Prioridad {r.prioridad}] {r.nombre}
                    </option>
                ))}
            </select>
            {loading && <div className="absolute right-8 top-2.5 text-xs text-slate-400">...</div>}
        </div>
    );
}
