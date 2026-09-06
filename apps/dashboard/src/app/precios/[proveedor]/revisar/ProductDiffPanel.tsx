'use client';
import { toast } from 'sonner';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Download, Check, X, ArrowRight, MousePointerClick } from 'lucide-react';
import { ProductDiffCard } from '@/components/precios/ProductDiffCard';
import { usePricingFlowState } from '@/components/precios/flow/usePricingFlowState';

export function ProductDiffPanel({ importacion, loteNum, proveedor, diffData }: { importacion: any, loteNum: number, proveedor: string, diffData: any[] }) {
    const router = useRouter();
    const { mutate } = usePricingFlowState(proveedor);

    // Filter states
    const [activeChip, setActiveChip] = useState<'todos' | 'nuevo' | 'cambio' | 'ausente' | 'sin_cambio'>('todos');
    const [search, setSearch] = useState('');
    const [soloCambiosMayores, setSoloCambiosMayores] = useState(false);
    const [soloAumentos, setSoloAumentos] = useState(false);

    // Decision state per product: key is articulo_id
    const [decisions, setDecisions] = useState<Record<string, 'aprobado'|'rechazado'|'pendiente'>>(
        () => {
            const initial: any = {};
            diffData.forEach(d => initial[d.articulo_id] = d.decision || 'pendiente');
            return initial;
        }
    );

    const [loading, setLoading] = useState(false);

    // Counts for chips
    const stats = useMemo(() => {
        let nuevos = 0, cambios = 0, ausentes = 0, sinCambio = 0;
        diffData.forEach(d => {
            if (d.row_class === 'nuevo') nuevos++;
            else if (d.row_class === 'cambio') cambios++;
            else if (d.row_class === 'ausente') ausentes++;
            else if (d.row_class === 'sin_cambio') sinCambio++;
        });
        return { nuevos, cambios, ausentes, sinCambio };
    }, [diffData]);

    const globalStats = useMemo(() => {
        let aprobados = 0, rechazados = 0, pendientes = 0;
        Object.values(decisions).forEach(val => {
            if (val === 'aprobado') aprobados++;
            else if (val === 'rechazado') rechazados++;
            else pendientes++;
        });
        return { aprobados, rechazados, pendientes };
    }, [decisions]);

    // Filtered data
    const filteredData = useMemo(() => {
        return diffData.filter(d => {
            if (activeChip !== 'todos' && d.row_class !== activeChip) return false;
            if (search) {
                const s = search.toLowerCase();
                if (!d.articulo_id?.toLowerCase().includes(s) && !d.modelo?.toLowerCase().includes(s) && !d.codigo_universal?.includes(s)) return false;
            }
            if (soloCambiosMayores && d.row_class === 'cambio') {
                const maxPct = Math.max(...Object.values(d.tiers).map((t:any) => Math.abs(t.delta_pct || 0)));
                if (maxPct < 5) return false;
            }
            if (soloAumentos && d.row_class === 'cambio') {
                const maxPct = Math.max(...Object.values(d.tiers).map((t:any) => t.delta_pct || 0));
                if (maxPct <= 0) return false;
            }
            return true;
        });
    }, [diffData, activeChip, search, soloCambiosMayores, soloAumentos]);

    const handleDecision = (articulo_id: string, decision: 'aprobado'|'rechazado') => {
        setDecisions(prev => ({ ...prev, [articulo_id]: decision }));
    };

    const handleBulkDecision = (decision: 'aprobado'|'rechazado') => {
        const next = { ...decisions };
        filteredData.forEach(d => {
            next[d.articulo_id] = decision;
        });
        setDecisions(next);
    };

    const handleAprobarLote = () => {
        if (!confirm('¿Estás seguro de aprobar todo el lote? Esto sobrescribirá las decisiones manuales.')) return;
        const next = { ...decisions };
        diffData.forEach(d => {
            next[d.articulo_id] = 'aprobado';
        });
        setDecisions(next);
        // Then auto-apply
        applyChanges(next);
    };

    const applyChanges = async (currentDecisions: Record<string, string>) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/precios/${encodeURIComponent(proveedor)}/decisiones-batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    importacion_id: importacion.id,
                    decisiones: currentDecisions
                })
            });
            if (res.ok) {
                await mutate();
                // Flujo B: tras guardar las decisiones, se va al resumen del lote
                // (ahí está el botón "Activar como Vigente"). La ruta /aplicar quedó deprecada.
                router.push(`/precios/${encodeURIComponent(proveedor)}/historial/${importacion.id}/resumen`);
            } else {
                toast.error('Error al guardar decisiones');
                setLoading(false);
            }
        } catch (e) {
            toast.error('Error de red');
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full relative">
            <div className="flex-1 overflow-auto pb-32">
                {/* Header / Chips */}
                <div className="bg-[var(--surface)] px-8 py-6 border-b border-[var(--border)] sticky top-0 z-20 shadow-sm">
                    <div className="flex justify-between items-start mb-4">
                        <h2 className="text-xl font-bold text-[var(--text)]">Auditoría de Precios — Lote #{loteNum}</h2>
                        <div className="flex items-center space-x-2 text-sm font-medium">
                            <span className="text-[var(--ok)] bg-[var(--ok)]/10 px-3 py-1 rounded-full">{globalStats.aprobados} aprobados</span>
                            <span className="text-[var(--err)] bg-[var(--err)]/10 px-3 py-1 rounded-full">{globalStats.rechazados} rechazados</span>
                            <span className="text-[var(--text-muted)] bg-[var(--surface-2)] px-3 py-1 rounded-full">{globalStats.pendientes} pendientes</span>
                        </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-3 mb-6">
                        <button onClick={() => setActiveChip('todos')} className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${activeChip === 'todos' ? 'bg-[var(--surface)] text-[var(--text)]' : 'bg-[var(--surface-2)] text-[var(--text-muted)] hover:bg-[var(--bg)]'}`}>
                            Todos ({diffData.length})
                        </button>
                        <button onClick={() => setActiveChip('nuevo')} className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${activeChip === 'nuevo' ? 'bg-[var(--ok)] text-[var(--accent-ink)]' : 'bg-[var(--ok)]/10 text-[var(--ok)] hover:bg-[var(--ok)]/20'}`}>
                            +{stats.nuevos} Nuevos
                        </button>
                        <button onClick={() => setActiveChip('cambio')} className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${activeChip === 'cambio' ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20'}`}>
                            Δ {stats.cambios} Cambios
                        </button>
                        <button onClick={() => setActiveChip('ausente')} className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${activeChip === 'ausente' ? 'bg-[var(--warn)] text-[var(--bg)]' : 'bg-[var(--warn)]/10 text-[var(--warn)] hover:bg-[var(--warn)]/20'}`}>
                            -{stats.ausentes} Ausentes
                        </button>
                        <button onClick={() => setActiveChip('sin_cambio')} className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${activeChip === 'sin_cambio' ? 'bg-[var(--surface)] text-[var(--text)]' : 'bg-[var(--surface-2)] text-[var(--text-muted)] hover:bg-[var(--bg)]'}`}>
                            {stats.sinCambio} Sin cambio
                        </button>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-6">
                            <div className="relative w-72">
                                <Search className="w-4 h-4 absolute left-3 top-2.5 text-[var(--text-faint)]" />
                                <input 
                                    type="text" 
                                    placeholder="Buscar SKU/modelo..." 
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    className="pl-9 pr-4 py-2 w-full border border-[var(--border)] rounded-md focus:ring-[var(--accent)] focus:border-[var(--accent)]"
                                />
                            </div>
                            <label className="flex items-center space-x-2 text-[var(--text-muted)] cursor-pointer">
                                <input type="checkbox" checked={soloCambiosMayores} onChange={e => setSoloCambiosMayores(e.target.checked)} className="rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]" />
                                <span>Solo cambios &gt; 5%</span>
                            </label>
                            <label className="flex items-center space-x-2 text-[var(--text-muted)] cursor-pointer">
                                <input type="checkbox" checked={soloAumentos} onChange={e => setSoloAumentos(e.target.checked)} className="rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]" />
                                <span>Solo aumentos</span>
                            </label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <button onClick={() => handleBulkDecision('aprobado')} className="flex items-center px-3 py-1.5 text-[var(--ok)] bg-[var(--ok)]/10 hover:bg-[var(--ok)]/20 rounded text-sm font-medium transition-colors">
                                <Check className="w-4 h-4 mr-1" /> Aprobar {filteredData.length} visibles
                            </button>
                            <button onClick={() => handleBulkDecision('rechazado')} className="flex items-center px-3 py-1.5 text-[var(--err)] bg-[var(--err)]/10 hover:bg-[var(--err)]/20 rounded text-sm font-medium transition-colors">
                                <X className="w-4 h-4 mr-1" /> Rechazar {filteredData.length} visibles
                            </button>
                        </div>
                    </div>
                </div>

                {/* Cards List */}
                <div className="p-8 max-w-5xl mx-auto">
                    {filteredData.map(d => (
                        <ProductDiffCard 
                            key={d.articulo_id} 
                            product={d} 
                            decision={decisions[d.articulo_id]}
                            onDecision={(decision) => handleDecision(d.articulo_id, decision as "aprobado" | "rechazado")}
                        />
                    ))}
                    {filteredData.length === 0 && (
                        <div className="py-24 text-center text-[var(--text-muted)]">
                            No hay resultados para los filtros actuales.
                        </div>
                    )}
                </div>
            </div>

            {/* Footer Fijo */}
            <div className="fixed bottom-0 left-0 right-0 bg-[var(--surface)] border-t border-[var(--border)] p-4 flex justify-between items-center shadow-[0_-10px_15px_-3px_rgb(0,0,0,0.05)] z-30 ml-64">
                <div className="text-sm font-medium pl-4 flex items-center space-x-3">
                    <span className="text-[var(--ok)]">{globalStats.aprobados} aprobados</span>
                    <span className="text-[var(--text-faint)]">·</span>
                    <span className="text-[var(--err)]">{globalStats.rechazados} rechazados</span>
                    <span className="text-[var(--text-faint)]">·</span>
                    <span className="text-[var(--text-muted)]">{globalStats.pendientes} pendientes</span>
                </div>
                <div className="flex items-center space-x-4 pr-4">
                    <button className="inline-flex items-center px-4 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg font-medium text-[var(--text-muted)] hover:bg-[var(--bg)] shadow-sm text-sm transition-colors">
                        <Download className="w-4 h-4 mr-2" /> Exportar diff
                    </button>
                    <button 
                        onClick={handleAprobarLote}
                        disabled={loading}
                        className="inline-flex items-center px-4 py-2 bg-[var(--ok)]/10 text-[var(--ok)] border border-[var(--ok)]/30 rounded-lg font-medium hover:bg-[var(--ok)]/20 shadow-sm text-sm transition-colors disabled:opacity-50"
                    >
                        <Check className="w-4 h-4 mr-2" /> Aprobar todo el lote
                    </button>
                    <button 
                        onClick={() => {
                            if (globalStats.pendientes > 0) {
                                if (!confirm(`Tienes ${globalStats.pendientes} SKUs sin decisión. ¿Deseas aprobarlos automáticamente y continuar?`)) return;
                                const next = { ...decisions };
                                Object.keys(next).forEach(k => {
                                    if (next[k] === 'pendiente') next[k] = 'aprobado';
                                });
                                setDecisions(next);
                                applyChanges(next);
                                return;
                            }
                            applyChanges(decisions);
                        }}
                        disabled={loading || globalStats.aprobados === 0 && globalStats.pendientes === 0}
                        className="inline-flex items-center px-8 py-3 bg-[var(--accent)] text-[var(--accent-ink)] rounded-lg font-medium hover:brightness-110 shadow-md transition-colors disabled:opacity-50 text-base"
                    >
                        {loading ? 'Guardando...' : 'Guardar y continuar'} <ArrowRight className="w-5 h-5 ml-2" />
                    </button>
                </div>
            </div>
        </div>
    );
}
