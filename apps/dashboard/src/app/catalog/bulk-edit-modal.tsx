import React, { useState } from 'react';
import { X, DollarSign, Percent, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { dashboardService } from '@/lib/dashboard-service';

export function BulkEditModal({
    isOpen,
    onClose,
    selectedSkus,
    onSuccess
}: {
    isOpen: boolean;
    onClose: () => void;
    selectedSkus: Set<string>;
    onSuccess: () => void;
}) {
    const [mode, setMode] = useState<'percentage' | 'fixed'>('percentage');
    const [value, setValue] = useState<number>(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    if (!isOpen) return null;

    const handleConfirm = async () => {
        if (!value || isNaN(value)) {
            setError('Por favor ingresa un valor numérico válido.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            // Get all configs to know which marketplace we are syncing
            const configs = await dashboardService.getMarketplaceConfigs();
            if (!configs || configs.length === 0) throw new Error("No hay cuentas de Marketplace configuradas.");

            // Tomamos la primera cuenta activa por ahora (Grupo Histofarma MeLi)
            const activeConfig = configs[0];

            await dashboardService.triggerBulkPriceUpdate(
                Array.from(selectedSkus),
                mode,
                value,
                activeConfig.id
            );

            onSuccess();
            onClose();
        } catch (err: any) {
            setError(err.message || 'Error al encolar la actualización masiva.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-slate-900">Edición Masiva de Precios</h3>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    <div className="bg-indigo-50 text-indigo-700 p-4 rounded-xl flex gap-3 text-sm">
                        <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                        <p>
                            Estás a punto de modificar el precio de <strong>{selectedSkus.size} SKUs</strong> en Mercado Libre.
                            Esta operación se enviará a la cola y se procesará en segundo plano.
                        </p>
                    </div>

                    <div className="space-y-4">
                        <label className="text-sm font-bold text-slate-700">Tipo de Modificación</label>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => setMode('percentage')}
                                className={cn(
                                    "px-4 py-3 rounded-xl border-2 flex items-center justify-center gap-2 text-sm font-semibold transition-all",
                                    mode === 'percentage' ? "border-indigo-600 text-indigo-700 bg-indigo-50" : "border-slate-200 text-slate-500 hover:border-slate-300"
                                )}
                            >
                                <Percent className="w-4 h-4" />
                                Porcentaje (+/-)
                            </button>
                            <button
                                onClick={() => setMode('fixed')}
                                className={cn(
                                    "px-4 py-3 rounded-xl border-2 flex items-center justify-center gap-2 text-sm font-semibold transition-all",
                                    mode === 'fixed' ? "border-indigo-600 text-indigo-700 bg-indigo-50" : "border-slate-200 text-slate-500 hover:border-slate-300"
                                )}
                            >
                                <DollarSign className="w-4 h-4" />
                                Precio Fijo
                            </button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700">
                            {mode === 'percentage' ? 'Valor del Porcentaje (Ej. 15 para +15%, -10 para -10%)' : 'Nuevo Precio Fijo Exacto'}
                        </label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                {mode === 'percentage' ? <Percent className="w-5 h-5 text-slate-400" /> : <DollarSign className="w-5 h-5 text-slate-400" />}
                            </div>
                            <input
                                type="number"
                                className="block w-full pl-10 pr-3 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-600 focus:border-transparent transition-shadow text-lg font-semibold"
                                placeholder={mode === 'percentage' ? "15" : "999.00"}
                                value={value || ''}
                                onChange={(e) => setValue(parseFloat(e.target.value))}
                            />
                        </div>
                    </div>

                    {error && (
                        <p className="text-sm text-rose-600 font-medium">{error}</p>
                    )}
                </div>

                <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 text-sm font-bold text-slate-600 hover:text-slate-800 transition-colors"
                        disabled={loading}
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={loading || selectedSkus.size === 0}
                        className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center justify-center min-w-[140px]"
                    >
                        {loading ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            "Confirmar Edición"
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
