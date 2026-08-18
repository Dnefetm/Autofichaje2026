'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Loader2 } from 'lucide-react';

interface Props {
    proveedor: string;
    importacionId: string;
    filaNum: number;
    codigoExcel: string;
    modeloExcel: string;
    marcaExcel: string;
    articuloId: string;
}

export function VinculacionActions({ proveedor, importacionId, filaNum, codigoExcel, modeloExcel, marcaExcel, articuloId }: Props) {
    const [loading, setLoading] = useState<'aceptar' | 'rechazar' | null>(null);
    const [done, setDone] = useState<'aceptado' | 'rechazado' | null>(null);
    const router = useRouter();

    const handleAceptar = async () => {
        setLoading('aceptar');
        try {
            const res = await fetch(`/api/precios/proveedor/${encodeURIComponent(proveedor)}/vincular`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    codigo_excel: codigoExcel,
                    modelo_excel: modeloExcel,
                    marca_excel: marcaExcel,
                    articulo_id: articuloId,
                    fila_raw_id: null,
                    importacion_id: importacionId
                })
            });
            if (res.ok) {
                setDone('aceptado');
            } else {
                const d = await res.json();
                alert(`Error: ${d.error}`);
            }
        } catch {
            alert('Error de red');
        } finally {
            setLoading(null);
        }
    };

    const handleRechazar = () => {
        // Marcar como rechazado localmente — no se guarda ningún alias
        setDone('rechazado');
    };

    if (done === 'aceptado') {
        return <span className="text-xs font-bold text-emerald-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Vinculado</span>;
    }
    if (done === 'rechazado') {
        return <span className="text-xs font-bold text-slate-400 flex items-center gap-1"><X className="w-3.5 h-3.5" /> Ignorado</span>;
    }

    return (
        <div className="flex items-center justify-center gap-1">
            <button
                onClick={handleAceptar}
                disabled={loading !== null}
                title="Aceptar vinculación propuesta"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
            >
                {loading === 'aceptar' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Aceptar
            </button>
            <button
                onClick={handleRechazar}
                disabled={loading !== null}
                title="Rechazar esta propuesta"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
            >
                <X className="w-3 h-3" />
                Ignorar
            </button>
        </div>
    );
}
