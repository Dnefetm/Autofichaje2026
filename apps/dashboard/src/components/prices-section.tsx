"use client";

/**
 * prices-section.tsx — Componente compartido para precios por cuenta MeLi.
 *
 * Usado en:
 *   - app/catalog/[id]/page.tsx  (por artículo)
 *   - app/fichas/[id]/page.tsx   (por artículo vinculado a la ficha)
 */

import { useState, useEffect } from 'react';
import { Store, DollarSign, Save, Loader2, PlusCircle, CheckCircle, Settings, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

// -- Tipos --------------------------------------------------------------------

interface PriceRowProps {
    articulo_id: string;
    /** Registro de marketplace_prices o { marketplace_id, account_name } sin precio */
    price: any;
    modeloDefault: string | null;
    onSaved: () => void;
}

export interface PricesSectionProps {
    articulo_id: string;
    modeloDefault: string | null;
}

// -- PricingRuleModal ---------------------------------------------------------

function PricingRuleModal({
    open,
    onClose,
    marketplace_id,
    account_name
}: {
    open: boolean;
    onClose: () => void;
    marketplace_id: string;
    account_name: string;
}) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    // Parametros de la regla
    const [margin, setMargin] = useState(20);
    const [comision, setComision] = useState(15);
    const [iva, setIva] = useState(16);
    const [fijo, setFijo] = useState(25);

    useEffect(() => {
        if (!open) return;
        setLoading(true);
        fetch(`/api/pricing-rules?marketplace_id=${marketplace_id}`)
            .then(r => r.json())
            .then(data => {
                if (data.ok && data.rule) {
                    setMargin(data.rule.value);
                    setComision(data.rule.ml_commission_percentage);
                    setIva(data.rule.tax_percentage);
                    setFijo(data.rule.ml_fixed_fee);
                }
            })
            .finally(() => setLoading(false));
    }, [open, marketplace_id]);

    async function handleSave() {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch('/api/pricing-rules', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    marketplace_id,
                    name: `Regla ${account_name}`,
                    rule_type: 'margin_percentage',
                    value: margin,
                    ml_commission_percentage: comision,
                    tax_percentage: iva,
                    ml_fixed_fee: fijo
                })
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                onClose();
            } else {
                setError(data.error || 'Error al guardar la regla');
            }
        } catch (e: any) {
            setError(e.message || 'Error de red al guardar la regla');
        } finally {
            setSaving(false);
        }
    }

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="font-bold text-slate-800">Fórmula de Precio: {account_name}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">×</button>
                </div>
                
                {loading ? (
                    <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>
                ) : (
                    <div className="p-6 space-y-4">
                        {error && (
                            <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm font-semibold flex items-center gap-2">
                                <AlertCircle className="w-4 h-4" />
                                {error}
                            </div>
                        )}
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">Margen de Ganancia Neto (%)</label>
                            <input type="number" value={margin} onChange={e => setMargin(Number(e.target.value))} className="w-full px-3 py-2 border rounded-lg" />
                            <p className="text-[10px] text-slate-400 mt-1">Porcentaje de ganancia libre después de todos los descuentos.</p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">Comisión MeLi (%)</label>
                                <input type="number" value={comision} onChange={e => setComision(Number(e.target.value))} className="w-full px-3 py-2 border rounded-lg" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">Impuesto (IVA %)</label>
                                <input type="number" value={iva} onChange={e => setIva(Number(e.target.value))} className="w-full px-3 py-2 border rounded-lg" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">Cargo Fijo MeLi ($)</label>
                            <input type="number" value={fijo} onChange={e => setFijo(Number(e.target.value))} className="w-full px-3 py-2 border rounded-lg" />
                        </div>
                    </div>
                )}
                
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg">Cancelar</button>
                    <button 
                        onClick={handleSave} 
                        disabled={saving || loading}
                        className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center gap-2"
                    >
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                        Aplicar y Recalcular
                    </button>
                </div>
            </div>
        </div>
    );
}

// -- PriceRow -----------------------------------------------------------------

function PriceRow({ articulo_id, price, modeloDefault, onSaved }: PriceRowProps) {
    const isNew = !price.sale_price;
    const [salePrice, setSalePrice] = useState<string>(price.sale_price?.toString() || '');
    const [basePrice, setBasePrice] = useState<string>(price.base_price?.toString() || '');
    const [skuTienda, setSkuTienda] = useState<string>(price.sku_tienda || modeloDefault || '');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [modalOpen, setModalOpen] = useState(false);

    // Sync input when DB calculation updates
    useEffect(() => {
        if (price.sale_price) setSalePrice(price.sale_price.toString());
        if (price.base_price) setBasePrice(price.base_price.toString());
    }, [price.sale_price, price.base_price]);

    const accountName =
        price.marketplace_configs?.account_name || price.account_name || price.marketplace_id;

    async function handleSave() {
        const salePriceNum = parseFloat(salePrice);
        if (!salePrice || isNaN(salePriceNum) || salePriceNum <= 0) {
            setErr('El precio de venta debe ser un número positivo');
            return;
        }
        setSaving(true);
        setErr(null);
        try {
            const res = await fetch(`/api/catalog/${articulo_id}/prices`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    marketplace_id: price.marketplace_id,
                    sale_price: salePriceNum,
                    base_price: basePrice ? parseFloat(basePrice) : undefined,
                    sku_tienda: skuTienda || undefined,
                }),
            });
            const data = await res.json();
            if (!data.ok) throw new Error(data.error);
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
            onSaved();
        } catch (e: any) {
            setErr(e.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className={cn(
            "rounded-xl border p-4 transition-all",
            isNew ? "bg-slate-50 border-dashed border-slate-300" : "bg-white border-slate-200"
        )}>
            {/* Cuenta */}
            <div className="flex items-center gap-2 mb-3">
                <Store className="w-4 h-4 text-yellow-500 shrink-0" />
                <span className="text-sm font-bold text-slate-800">{accountName}</span>
                {!isNew && (
                    <span className="ml-auto text-xs text-slate-400">
                        {price.updated_at ? new Date(price.updated_at).toLocaleDateString('es-MX') : ''}
                    </span>
                )}
                {isNew && (
                    <span className="ml-auto text-xs bg-slate-200 text-slate-500 font-semibold px-2 py-0.5 rounded-full">
                        Sin configurar
                    </span>
                )}
            </div>

            {/* Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Precio venta */}
                <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1">
                        Precio Venta (Calculado o Manual)
                    </label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium">$</span>
                        <input
                            type="number"
                            step="0.01"
                            value={salePrice}
                            onChange={(e) => setSalePrice(e.target.value)}
                            placeholder="0.00"
                            className="w-full pl-7 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                        />
                    </div>
                </div>

                {/* Precio Base */}
                <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1">
                        Precio Lista (Opcional)
                    </label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium">$</span>
                        <input
                            type="number"
                            step="0.01"
                            value={basePrice}
                            onChange={(e) => setBasePrice(e.target.value)}
                            placeholder="0.00"
                            className="w-full pl-7 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                    </div>
                </div>

                {/* SKU Tienda */}
                <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1">
                        SKU Tienda
                    </label>
                    <input
                        type="text"
                        value={skuTienda}
                        onChange={(e) => setSkuTienda(e.target.value)}
                        placeholder={modeloDefault || 'SKU'}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                    />
                </div>
            </div>

            {/* Error / Footer */}
            <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-3">
                    <button 
                        onClick={() => setModalOpen(true)}
                        className="text-xs font-semibold text-indigo-600 flex items-center gap-1 hover:text-indigo-800 transition-colors"
                    >
                        <Settings className="w-3.5 h-3.5" />
                        Configurar Fórmula
                    </button>
                    {err && <span className="text-xs text-rose-500 font-medium ml-2">{err}</span>}
                </div>
                
                <button
                    id={`save-price-${price.marketplace_id}`}
                    onClick={handleSave}
                    disabled={saving}
                    className={cn(
                        "flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all",
                        saved
                            ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                            : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
                    )}
                >
                    {saving
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : saved
                            ? <CheckCircle className="w-3.5 h-3.5" />
                            : isNew
                                ? <PlusCircle className="w-3.5 h-3.5" />
                                : <Save className="w-3.5 h-3.5" />
                    }
                    {saved ? 'Guardado' : isNew ? 'Agregar' : 'Guardar'}
                </button>
            </div>

            <PricingRuleModal 
                open={modalOpen} 
                onClose={() => {
                    setModalOpen(false);
                    onSaved(); // reload prices when modal closes in case recalculation updated them
                }}
                marketplace_id={price.marketplace_id}
                account_name={accountName}
            />
        </div>
    );
}

// -- PricesSection -------------------------------------------------------------

export function PricesSection({ articulo_id, modeloDefault }: PricesSectionProps) {
    const [prices, setPrices] = useState<any[]>([]);
    const [unconfigured, setUnconfigured] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    async function loadPrices() {
        setLoading(true);
        try {
            const res = await fetch(`/api/catalog/${articulo_id}/prices`);
            const data = await res.json();
            if (data.ok) {
                setPrices(data.prices || []);
                setUnconfigured(data.unconfigured || []);
            }
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { loadPrices(); }, [articulo_id]);

    const allRows = [
        ...prices,
        ...unconfigured.map(u => ({ marketplace_id: u.id, account_name: u.account_name })),
    ];

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
                <DollarSign className="w-5 h-5 text-indigo-500" />
                <h2 className="text-lg font-bold text-slate-900">Precios para MeLi</h2>
                {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400 ml-auto" />}
            </div>

            {!loading && allRows.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-6">
                    No hay cuentas MeLi activas configuradas.
                </p>
            )}

            <div className="space-y-3">
                {allRows.map((row) => (
                    <PriceRow
                        key={row.marketplace_id}
                        articulo_id={articulo_id}
                        price={row}
                        modeloDefault={modeloDefault}
                        onSaved={loadPrices}
                    />
                ))}
            </div>
        </div>
    );
}
