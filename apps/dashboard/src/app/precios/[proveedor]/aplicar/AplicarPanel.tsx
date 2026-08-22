'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, X, AlertCircle, RefreshCw, Layers } from 'lucide-react';
import { usePricingFlowState } from '@/components/precios/flow/usePricingFlowState';

export function AplicarPanel({ importacion, loteNum, stats, proveedor }: { importacion: any, loteNum: number, stats: any, proveedor: string }) {
    const [step, setStep] = useState<'resumen' | 'ejecutando' | 'exito'>('resumen');
    const [progress, setProgress] = useState(0);
    const { mutate } = usePricingFlowState(proveedor);
    const router = useRouter();

    const handleConfirm = async () => {
        setStep('ejecutando');
        
        // Simulating the DB operation delay for UI
        await new Promise(r => setTimeout(r, 1000));
        setProgress(33);

        try {
            const res = await fetch(`/api/precios/${encodeURIComponent(proveedor)}/aplicar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ importacion_id: importacion.id })
            });
            
            if (!res.ok) throw new Error('Failed to apply');
            
            setProgress(66);
            
            // Simulating queue enqueue delay
            await new Promise(r => setTimeout(r, 1500));
            setProgress(100);
            
            await mutate();
            setTimeout(() => setStep('exito'), 500);

        } catch (e) {
            alert('Error al aplicar cambios');
            setStep('resumen');
        }
    };

    if (step === 'ejecutando') {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] bg-[var(--bg)] p-8">
                <div className="max-w-md w-full bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-xl overflow-hidden p-8">
                    <h2 className="text-xl font-bold text-[var(--text)] mb-6 text-center">Aplicando Lote #{loteNum}...</h2>
                    
                    <div className="space-y-4">
                        <div className={`flex items-center ${progress >= 33 ? 'text-[var(--ok)]' : 'text-[var(--text-faint)]'}`}>
                            {progress >= 33 ? <Check className="w-5 h-5 mr-3" /> : <div className="w-5 h-5 border-2 border-current rounded-full mr-3 animate-pulse" />}
                            <span className="font-medium">Lista de precios actualizada en BD</span>
                        </div>
                        <div className={`flex items-center ${progress >= 66 ? 'text-[var(--ok)]' : progress >= 33 ? 'text-[var(--accent)]' : 'text-[var(--text-faint)]'}`}>
                            {progress >= 66 ? <Check className="w-5 h-5 mr-3" /> : progress >= 33 ? <RefreshCw className="w-5 h-5 mr-3 animate-spin" /> : <div className="w-5 h-5 border-2 border-current rounded-full mr-3" />}
                            <span className="font-medium">Encolando recálculo en Mercado Libre...</span>
                        </div>
                        <div className={`flex items-center ${progress >= 100 ? 'text-[var(--ok)]' : progress >= 66 ? 'text-[var(--accent)]' : 'text-[var(--text-faint)]'}`}>
                            {progress >= 100 ? <Check className="w-5 h-5 mr-3" /> : progress >= 66 ? <RefreshCw className="w-5 h-5 mr-3 animate-spin" /> : <div className="w-5 h-5 border-2 border-current rounded-full mr-3" />}
                            <span className="font-medium">Notificando a Reglas de Rentabilidad</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (step === 'exito') {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] bg-[var(--bg)] p-8">
                <div className="max-w-md w-full bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-xl overflow-hidden">
                    <div className="bg-[var(--ok)]/100 p-6 flex flex-col items-center justify-center text-[var(--accent-ink)]">
                        <Check className="w-16 h-16 mb-4 opacity-90" />
                        <h2 className="text-2xl font-bold tracking-tight">Lote #{loteNum} aplicado</h2>
                    </div>
                    <div className="p-8 space-y-4 text-center">
                        <p className="text-[var(--text-muted)] font-medium">{stats.actualizados} precios actualizados</p>
                        <p className="text-[var(--text-muted)] font-medium">{stats.nuevos} nuevos en lista</p>
                        <p className="text-[var(--text-muted)] font-medium">{stats.descontinuados} descontinuados</p>
                        <p className="text-[var(--accent)] font-medium mt-4">Publicaciones encoladas para sync con MeLi</p>
                        
                        <div className="pt-6 mt-6 border-t border-[var(--border)] flex gap-4">
                            <Link href={`/precios/${encodeURIComponent(proveedor)}`} className="flex-1 px-4 py-2 bg-[var(--surface-2)] text-[var(--accent-ink)] rounded-lg font-medium hover:bg-[var(--surface)] transition-colors">
                                Volver al Hub
                            </Link>
                            <Link href={`/precios/${encodeURIComponent(proveedor)}/historico`} className="flex-1 px-4 py-2 bg-[var(--surface)] border border-slate-300 text-[var(--text-muted)] rounded-lg font-medium hover:bg-[var(--bg)] transition-colors">
                                Ver histórico
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] bg-[var(--bg)] p-8">
            <div className="max-w-md w-full bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-xl overflow-hidden">
                <div className="p-6 border-b border-[var(--border)]">
                    <h2 className="text-xl font-bold text-[var(--text)]">Resumen del Lote #{loteNum}</h2>
                </div>
                <div className="p-6 space-y-4">
                    <div className="flex items-center text-[var(--ok)] font-medium">
                        <Check className="w-5 h-5 mr-3 text-emerald-500" /> {stats.actualizados} precios actualizados
                    </div>
                    <div className="flex items-center text-[var(--ok)] font-medium">
                        <Check className="w-5 h-5 mr-3 text-emerald-500" /> {stats.nuevos} SKUs nuevos añadidos a la lista
                    </div>
                    <div className="flex items-center text-[var(--ok)] font-medium">
                        <Check className="w-5 h-5 mr-3 text-emerald-500" /> {stats.descontinuados} SKUs marcados como descontinuados
                    </div>
                    <div className="flex items-center text-[var(--err)] font-medium">
                        <X className="w-5 h-5 mr-3 text-[var(--err)]" /> {stats.rechazados} cambios rechazados (no se aplicarán)
                    </div>
                    <div className="flex items-center text-[var(--text-muted)] font-medium">
                        <div className="w-5 h-5 rounded-full border-2 border-slate-300 mr-3 flex items-center justify-center"></div>
                        {stats.sin_cambio} sin cambio (no aplica)
                    </div>
                </div>
                <div className="p-6 bg-[var(--bg)] border-t border-[var(--border)] flex justify-between">
                    <button onClick={() => router.back()} className="px-4 py-2 text-[var(--text-muted)] font-medium hover:text-[var(--text)] transition-colors flex items-center">
                        <ArrowLeft className="w-4 h-4 mr-2" /> Volver a Revisar
                    </button>
                    <button onClick={handleConfirm} className="px-6 py-2 bg-[var(--accent)] text-[var(--accent-ink)] rounded-lg font-medium hover:brightness-110 shadow-sm transition-colors flex items-center">
                        <Check className="w-4 h-4 mr-2" /> Confirmar y aplicar
                    </button>
                </div>
            </div>
        </div>
    );
}
