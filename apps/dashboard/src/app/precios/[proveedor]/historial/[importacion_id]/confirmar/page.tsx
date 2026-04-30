'use client';
import { useState, use } from 'react';
import { Check, Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export function PriceConfirmationPanel({ importacionId, proveedor }: { importacionId: string, proveedor: string }) {
    const [tab, setTab] = useState<'individual' | 'lote' | 'todos'>('lote');
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleConfirm = async () => {
        setLoading(true);
        try {
            // Trigger confirmation logic (this would hit an API)
            // Simulating API call for now based on the requested UI
            await new Promise(r => setTimeout(r, 1000));
            alert(`Precios confirmados en modo: ${tab}`);
            router.push(`/precios/${encodeURIComponent(proveedor)}/historial`);
        } catch (e) {
            alert('Error confirmando precios');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200">
            <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-bold text-slate-900">Confirmación de Precios</h2>
                    <p className="text-sm text-slate-500">Importación: {importacionId}</p>
                </div>
                <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button onClick={() => setTab('individual')} className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === 'individual' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-600 hover:text-slate-900'}`}>Individual</button>
                    <button onClick={() => setTab('lote')} className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === 'lote' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-600 hover:text-slate-900'}`}>Lote 200</button>
                    <button onClick={() => setTab('todos')} className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === 'todos' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-600 hover:text-slate-900'}`}>Todos</button>
                </div>
            </div>
            
            <div className="p-6">
                {tab === 'individual' && (
                    <div className="text-center py-12 text-slate-500">
                        Selecciona artículos individualmente para confirmar sus precios calculados.
                    </div>
                )}
                {tab === 'lote' && (
                    <div className="text-center py-12 text-slate-500">
                        Confirmarás los próximos 200 artículos con matching exacto.
                    </div>
                )}
                {tab === 'todos' && (
                    <div className="text-center py-12 text-slate-500">
                        <span className="text-red-500 font-medium block mb-2">⚠️ Atención</span>
                        Se confirmarán todos los artículos de esta importación.
                    </div>
                )}
            </div>

            <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex justify-end">
                <button 
                    onClick={handleConfirm}
                    disabled={loading}
                    className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center"
                >
                    {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                    Confirmar {tab === 'lote' ? 'Lote' : tab === 'todos' ? 'Todos' : 'Selección'}
                </button>
            </div>
        </div>
    );
}

export default function ConfirmarPageWrapper({ params }: { params: Promise<{ proveedor: string, importacion_id: string }> }) {
    const resolvedParams = use(params);
    return (
        <div className="p-8 max-w-5xl mx-auto">
            <Link href={`/precios/${encodeURIComponent(resolvedParams.proveedor)}/historial`} className="inline-flex items-center text-sm text-indigo-600 mb-6 hover:underline">
                <ArrowLeft className="w-4 h-4 mr-1" /> Volver al historial
            </Link>
            <PriceConfirmationPanel importacionId={resolvedParams.importacion_id} proveedor={decodeURIComponent(resolvedParams.proveedor)} />
        </div>
    );
}
