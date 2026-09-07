import React from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ProductDiffCard({ product, decision, onDecision }: { product: any, decision: string, onDecision: (d: 'aprobado'|'rechazado'|'pendiente') => void }) {

    const { row_class, tiers } = product;

    // Tipos de precio dinámicos (no fijos): cada proveedor define los suyos.
    const tierKeys = Object.keys(tiers || {}).sort();
    const gridCols = `140px repeat(${tierKeys.length}, minmax(0, 1fr))`;

    const fmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

    const isNuevo = row_class === 'nuevo';
    const isAusente = row_class === 'ausente';
    const isSinCambio = row_class === 'sin_cambio';

    const renderTierDelta = (tier: any) => {
        if (!tier || tier.delta_pct == null) return null;
        const isUp = tier.delta_pct > 0;
        return (
            <div
                className={cn("text-[11px] font-medium mt-0.5 cursor-help", isUp ? "text-[var(--err)]" : "text-[var(--ok)]")}
                title={`Diferencia: ${isUp ? '+' : ''}${fmt.format(tier.delta_val || 0)}`}
            >
                {isUp ? '+' : ''}{tier.delta_pct.toFixed(1)}% {isUp ? '🔴' : '🟢'}
            </div>
        );
    };

    const isAprobado = decision === 'aprobado';
    const isRechazado = decision === 'rechazado';

    return (
        <div className={cn(
            "bg-[var(--surface)] rounded-lg border mb-6 shadow-sm overflow-hidden transition-all",
            isAprobado ? "border-[var(--ok)]/40 ring-1 ring-[var(--ok)]/20" :
            isRechazado ? "border-[var(--err)]/40 ring-1 ring-[var(--err)]/20" :
            isAusente ? "border-[var(--border)] opacity-75" : "border-[var(--border)]"
        )}>
            {/* Row 1: Header */}
            <div className="px-5 py-3 border-b border-[var(--border)] flex items-start justify-between bg-[var(--surface)]">
                <div className="flex items-start">
                    <div className="mt-1 mr-3 flex-shrink-0">
                        {isAprobado ? (
                            <div className="w-5 h-5 bg-[var(--ok)]/100 text-[var(--accent-ink)] rounded flex items-center justify-center">
                                <Check className="w-3 h-3" strokeWidth={3} />
                            </div>
                        ) : isRechazado ? (
                            <div className="w-5 h-5 bg-[var(--err)]/100 text-[var(--accent-ink)] rounded flex items-center justify-center">
                                <X className="w-3 h-3" strokeWidth={3} />
                            </div>
                        ) : (
                            <div className="w-5 h-5 border-2 border-[var(--border)] rounded" />
                        )}
                    </div>
                    <div>
                        <div className="flex items-center flex-wrap gap-2">
                            <span className={cn("font-semibold text-[var(--text)]", isAusente && "line-through text-[var(--text-muted)]")}>
                                {product.marca}{product.marca ? ' · ' : ''}<span className="font-mono text-sm">{product.codigo_universal}</span>
                            </span>
                            {isNuevo && <span className="text-[10px] font-bold tracking-wider uppercase bg-[var(--accent)]/20 text-[var(--accent)] px-1.5 py-0.5 rounded">Nuevo</span>}
                            {isAusente && <span className="text-[10px] font-bold tracking-wider uppercase bg-[var(--surface-2)] text-[var(--text-muted)] px-1.5 py-0.5 rounded">Ausente</span>}
                            {isSinCambio && <span className="text-[10px] font-bold tracking-wider uppercase bg-[var(--surface-2)] text-[var(--text-muted)] px-1.5 py-0.5 rounded">Sin cambio</span>}
                        </div>
                        <p className="text-[13px] text-[var(--text-muted)] mt-0.5 truncate max-w-xl" title={product.nombre}>{product.nombre}</p>
                    </div>
                </div>

                <div className="flex space-x-1 ml-4 flex-shrink-0">
                    <button
                        onClick={() => onDecision(isAprobado ? 'pendiente' : 'aprobado')}
                        className={cn(
                            "px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center",
                            isAprobado ? "bg-[var(--ok)]/15 text-[var(--ok)]" : "bg-[var(--surface)] hover:bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]"
                        )}
                    >
                        {isAprobado && <Check className="w-4 h-4 mr-1.5" />}
                        {isNuevo ? 'Añadir a lista' : isAusente ? 'Marcar descontinuado' : 'Aprobar'}
                    </button>
                    <button
                        onClick={() => onDecision(isRechazado ? 'pendiente' : 'rechazado')}
                        className={cn(
                            "px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center",
                            isRechazado ? "bg-[var(--err)]/15 text-[var(--err)]" : "bg-[var(--surface)] hover:bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]"
                        )}
                    >
                        {isRechazado && <X className="w-4 h-4 mr-1.5" />}
                        {isNuevo ? 'Ignorar' : isAusente ? 'Mantener vigente' : 'Rechazar'}
                    </button>
                </div>
            </div>

            {!isSinCambio && (
                <div className="flex flex-col">
                    {/* Headers dinámicos por tipo de precio */}
                    <div className="bg-[var(--surface-2)] grid px-5 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider border-b border-[var(--border)]" style={{ gridTemplateColumns: gridCols }}>
                        <div></div>
                        {tierKeys.map(k => (
                            <div key={k} className="text-right capitalize">{k.replace(/_/g, ' ')}</div>
                        ))}
                    </div>

                    {/* Vigente */}
                    <div className="grid px-5 py-2.5 items-center border-b border-[var(--border)]" style={{ gridTemplateColumns: gridCols }}>
                        <div className="text-[13px] font-medium text-[var(--text-muted)] flex items-center">
                            <span className="w-2 h-2 rounded-full bg-[var(--text-faint)] mr-2"></span> Vigente
                        </div>
                        {tierKeys.map(k => (
                            <div key={k} className="text-right text-sm text-[var(--text-muted)]">
                                {tiers[k]?.vigente != null ? fmt.format(tiers[k].vigente) : '—'}
                            </div>
                        ))}
                    </div>

                    {/* Nuevo */}
                    <div className="grid px-5 py-3 items-start bg-[var(--accent)]/5" style={{ gridTemplateColumns: gridCols }}>
                        <div className="text-[13px] font-bold text-[var(--accent)] flex items-center pt-1">
                            <span className="w-2 h-2 rounded-full bg-[var(--accent)]/100 mr-2"></span> Nuevo
                        </div>
                        {isAusente ? (
                            <div className="col-span-full text-center text-[13px] italic text-[var(--text-muted)] py-1">
                                — no vino en Excel —
                            </div>
                        ) : (
                            tierKeys.map(k => (
                                <div key={k} className="text-right">
                                    <div className="text-sm font-bold text-[var(--text)]">{tiers[k]?.nuevo != null ? fmt.format(tiers[k].nuevo) : '—'}</div>
                                    {renderTierDelta(tiers[k])}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
