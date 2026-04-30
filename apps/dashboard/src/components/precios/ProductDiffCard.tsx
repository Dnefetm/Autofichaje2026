import React from 'react';
import { Check, X, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ProductDiffCard({ product, decision, onDecision }: { product: any, decision: string, onDecision: (d: 'aprobado'|'rechazado'|'pendiente') => void }) {
    
    const { row_class, tiers } = product;
    
    // Formatting helper
    const fmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

    const isNuevo = row_class === 'nuevo';
    const isAusente = row_class === 'ausente';
    const isSinCambio = row_class === 'sin_cambio';

    const renderTierDelta = (tier: any) => {
        if (!tier.delta_pct) return null;
        const isUp = tier.delta_pct > 0;
        return (
            <div 
                className={cn("text-[11px] font-medium mt-0.5 cursor-help", isUp ? "text-rose-600" : "text-emerald-600")}
                title={`Diferencia: ${isUp ? '+' : ''}${fmt.format(tier.delta_val)}`}
            >
                {isUp ? '+' : ''}{tier.delta_pct.toFixed(1)}% {isUp ? '🔴' : '🟢'}
            </div>
        );
    };

    const isAprobado = decision === 'aprobado';
    const isRechazado = decision === 'rechazado';

    return (
        <div className={cn(
            "bg-white rounded-lg border mb-6 shadow-sm overflow-hidden transition-all",
            isAprobado ? "border-emerald-300 ring-1 ring-emerald-500/20" : 
            isRechazado ? "border-rose-300 ring-1 ring-rose-500/20" : 
            isAusente ? "border-slate-200 opacity-75" : "border-slate-200"
        )}>
            {/* Row 1: Header */}
            <div className="px-5 py-3 border-b border-slate-100 flex items-start justify-between bg-white">
                <div className="flex items-start">
                    {/* Simplified Checkbox for visual consistency */}
                    <div className="mt-1 mr-3 flex-shrink-0">
                        {isAprobado ? (
                            <div className="w-5 h-5 bg-emerald-500 text-white rounded flex items-center justify-center">
                                <Check className="w-3 h-3" strokeWidth={3} />
                            </div>
                        ) : isRechazado ? (
                            <div className="w-5 h-5 bg-rose-500 text-white rounded flex items-center justify-center">
                                <X className="w-3 h-3" strokeWidth={3} />
                            </div>
                        ) : (
                            <div className="w-5 h-5 border-2 border-slate-300 rounded" />
                        )}
                    </div>
                    <div>
                        <div className="flex items-center flex-wrap gap-2">
                            <span className={cn("font-semibold text-slate-900", isAusente && "line-through text-slate-500")}>
                                {product.marca} · {product.modelo} · <span className="font-mono text-sm">{product.codigo_universal}</span>
                            </span>
                            {isNuevo && <span className="text-[10px] font-bold tracking-wider uppercase bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">Nuevo</span>}
                            {isAusente && <span className="text-[10px] font-bold tracking-wider uppercase bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">Ausente</span>}
                            {isSinCambio && <span className="text-[10px] font-bold tracking-wider uppercase bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">Sin cambio</span>}
                        </div>
                        <p className="text-[13px] text-slate-500 mt-0.5 truncate max-w-xl" title={product.nombre}>{product.nombre}</p>
                    </div>
                </div>
                
                <div className="flex space-x-1 ml-4 flex-shrink-0">
                    <button 
                        onClick={() => onDecision(isAprobado ? 'pendiente' : 'aprobado')}
                        className={cn(
                            "px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center",
                            isAprobado ? "bg-emerald-100 text-emerald-800" : "bg-white hover:bg-slate-50 text-slate-600 border border-slate-200"
                        )}
                    >
                        {isAprobado && <Check className="w-4 h-4 mr-1.5" />}
                        {isNuevo ? 'Añadir a lista' : isAusente ? 'Marcar descontinuado' : 'Aprobar'}
                    </button>
                    <button 
                        onClick={() => onDecision(isRechazado ? 'pendiente' : 'rechazado')}
                        className={cn(
                            "px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center",
                            isRechazado ? "bg-rose-100 text-rose-800" : "bg-white hover:bg-slate-50 text-slate-600 border border-slate-200"
                        )}
                    >
                        {isRechazado && <X className="w-4 h-4 mr-1.5" />}
                        {isNuevo ? 'Ignorar' : isAusente ? 'Mantener vigente' : 'Rechazar'}
                    </button>
                </div>
            </div>

            {/* If not expanded and sin cambio, we could collapse, but mockup shows it open or implies it. Let's collapse if sin_cambio */}
            {!isSinCambio && (
                <div className="flex flex-col">
                    {/* Row 2: Headers */}
                    <div className="bg-[#FAFAFA] grid grid-cols-5 px-5 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                        <div></div>
                        <div className="text-right">Distribuidor</div>
                        <div className="text-right">Subdistribuidor</div>
                        <div className="text-right">Mayoreo</div>
                        <div className="text-right">Menudeo</div>
                    </div>

                    {/* Row 3: Vigente */}
                    <div className="grid grid-cols-5 px-5 py-2.5 items-center border-b border-slate-50">
                        <div className="text-[13px] font-medium text-slate-500 flex items-center">
                            <span className="w-2 h-2 rounded-full bg-slate-300 mr-2"></span> Vigente
                        </div>
                        <div className="text-right text-sm text-slate-600">{product.tiers.distribuidor.vigente ? fmt.format(product.tiers.distribuidor.vigente) : '—'}</div>
                        <div className="text-right text-sm text-slate-600">{product.tiers.subdistribuidor.vigente ? fmt.format(product.tiers.subdistribuidor.vigente) : '—'}</div>
                        <div className="text-right text-sm text-slate-600">{product.tiers.mayoreo.vigente ? fmt.format(product.tiers.mayoreo.vigente) : '—'}</div>
                        <div className="text-right text-sm text-slate-600">{product.tiers.menudeo.vigente ? fmt.format(product.tiers.menudeo.vigente) : '—'}</div>
                    </div>

                    {/* Row 4: Nuevo */}
                    <div className="grid grid-cols-5 px-5 py-3 items-start bg-[#F5F8FF]">
                        <div className="text-[13px] font-bold text-indigo-900 flex items-center pt-1">
                            <span className="w-2 h-2 rounded-full bg-indigo-500 mr-2"></span> Nuevo
                        </div>
                        
                        {isAusente ? (
                            <div className="col-span-4 text-center text-[13px] italic text-slate-500 py-1">
                                — no vino en Excel —
                            </div>
                        ) : (
                            <>
                                <div className="text-right">
                                    <div className="text-sm font-bold text-slate-900">{product.tiers.distribuidor.nuevo ? fmt.format(product.tiers.distribuidor.nuevo) : '—'}</div>
                                    {renderTierDelta(product.tiers.distribuidor)}
                                </div>
                                <div className="text-right">
                                    <div className="text-sm font-bold text-slate-900">{product.tiers.subdistribuidor.nuevo ? fmt.format(product.tiers.subdistribuidor.nuevo) : '—'}</div>
                                    {renderTierDelta(product.tiers.subdistribuidor)}
                                </div>
                                <div className="text-right">
                                    <div className="text-sm font-bold text-slate-900">{product.tiers.mayoreo.nuevo ? fmt.format(product.tiers.mayoreo.nuevo) : '—'}</div>
                                    {renderTierDelta(product.tiers.mayoreo)}
                                </div>
                                <div className="text-right">
                                    <div className="text-sm font-bold text-slate-900">{product.tiers.menudeo.nuevo ? fmt.format(product.tiers.menudeo.nuevo) : '—'}</div>
                                    {renderTierDelta(product.tiers.menudeo)}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
