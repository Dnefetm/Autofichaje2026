"use client";

/**
 * prices-section.tsx — Componente compartido para precios por cuenta MeLi.
 *
 * Usado en:
 *   - app/catalog/[id]/page.tsx  (por artículo)
 *   - app/fichas/[id]/page.tsx   (por artículo vinculado a la ficha)
 */

import { useState, useEffect } from 'react';
import { Store, DollarSign, Save, Loader2, PlusCircle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Tipos ────────────────────────────────────────────────────────────────────

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

// ── PriceRow ─────────────────────────────────────────────────────────────────

function PriceRow({ articulo_id, price, modeloDefault, onSaved }: PriceRowProps) {
    const isNew = !price.sale_price;
    const [salePrice, setSalePrice] = useState<string>(price.sale_price?.toString() || '');
    const [basePrice, setBasePrice] = useState<string>(price.base_price?.toString() || '');
    const [skuTienda, setSkuTienda] = useState<string>(price.sku_tienda || modeloDefault || '');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [err, setErr] = useState<string | null>(null);

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
                        Precio Venta <span className="text-rose-400">*</span>
                    </label>
                    <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">$</span>
                        <input
                            id={`sale-price-${price.marketplace_id}`}
                            type="number"
                            min="0"
                            step="0.01"
                            value={salePrice}
                            onChange={e => { setSalePrice(e.target.value); setErr(null); }}
                            placeholder="0.00"
                            className="w-full pl-7 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                        />
                    </div>
                </div>

                {/* Precio base */}
                <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1">
                        Precio Base / Lista
                    </label>
                    <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">$</span>
                        <input
                            id={`base-price-${price.marketplace_id}`}
                            type="number"
                            min="0"
                            step="0.01"
                            value={basePrice}
                            onChange={e => setBasePrice(e.target.value)}
                            placeholder="Opcional"
                            className="w-full pl-7 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                        />
                    </div>
                </div>

                {/* SKU Tienda */}
                <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-1">
                        SKU Tienda
                    </label>
                    <input
                        id={`sku-tienda-${price.marketplace_id}`}
                        type="text"
                        value={skuTienda}
                        onChange={e => setSkuTienda(e.target.value)}
                        placeholder={modeloDefault || 'Modelo del artículo'}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white font-mono"
                    />
                </div>
            </div>

            {/* Error / Footer */}
            <div className="flex items-center justify-between mt-3">
                <div>
                    {err && <p className="text-xs text-rose-500 font-medium">{err}</p>}
                    {!isNew && !err && (
                        <p className="text-xs text-slate-400">
                            Actual: <span className="font-bold text-slate-600">
                                {new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(price.sale_price)}
                            </span>
                            {price.base_price
                                ? <> · Lista: {new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(price.base_price)}</>
                                : ''}
                        </p>
                    )}
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
        </div>
    );
}

// ── PricesSection ─────────────────────────────────────────────────────────────

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
