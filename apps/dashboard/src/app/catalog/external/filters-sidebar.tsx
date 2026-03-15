"use client";

import React from 'react';
import { ChevronDown, ChevronUp, X, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FilterState {
    marketplace_id: string | null;
    statusExterno: string[];
    mapeoFilter: 'all' | 'unmapped' | 'mapped';
    brands: string[];
    domainIds: string[];
    listingTypes: string[];
    logisticTypes: string[];
    freeShipping: boolean | null;
    healthRange: 'high' | 'medium' | 'low' | 'none' | null;
    condition: 'new' | 'used' | null;
    priceMin: number | null;
    priceMax: number | null;
    salesRange: '0' | '1-10' | '11-50' | '50+' | null;
    stockRange: '0' | '1-5' | '6-20' | '20+' | null;
    sortBy: 'creado_el' | 'precio_venta' | 'sold_quantity' | 'health' | 'stock_publicado' | 'titulo';
    sortDir: 'asc' | 'desc';
}

export const defaultFilters: FilterState = {
    marketplace_id: null,
    statusExterno: [],
    mapeoFilter: 'all',
    brands: [],
    domainIds: [],
    listingTypes: [],
    logisticTypes: [],
    freeShipping: null,
    healthRange: null,
    condition: null,
    priceMin: null,
    priceMax: null,
    salesRange: null,
    stockRange: null,
    sortBy: 'creado_el',
    sortDir: 'desc',
};

interface FacetItem { value: string; label: string; count?: number; }

interface FiltersSidebarProps {
    filters: FilterState;
    onChange: (f: FilterState) => void;
    facets: {
        brands: FacetItem[];
        domains: FacetItem[];
    };
    marketplaces: { id: string; account_name: string; count?: number }[];
}

function Accordion({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
    const [open, setOpen] = React.useState(defaultOpen);
    return (
        <div className="border-b border-slate-100">
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between py-3 px-1 text-xs font-bold text-slate-500 uppercase tracking-wider hover:text-slate-700 transition-colors"
            >
                {title}
                {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {open && <div className="pb-3 px-1 space-y-1">{children}</div>}
        </div>
    );
}

function CheckItem({ label, checked, count, onChange }: { label: string; checked: boolean; count?: number; onChange: () => void }) {
    return (
        <label className="flex items-center justify-between gap-2 group cursor-pointer">
            <div className="flex items-center gap-2">
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={onChange}
                    className="w-3.5 h-3.5 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500"
                />
                <span className={cn("text-xs", checked ? "text-slate-900 font-semibold" : "text-slate-600 group-hover:text-slate-900")}>{label}</span>
            </div>
            {count !== undefined && (
                <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{count}</span>
            )}
        </label>
    );
}

function RadioItem({ label, selected, onChange }: { label: string; selected: boolean; onChange: () => void }) {
    return (
        <label className="flex items-center gap-2 group cursor-pointer">
            <input type="radio" checked={selected} onChange={onChange} className="w-3.5 h-3.5 text-indigo-600 border-slate-300 focus:ring-indigo-500" />
            <span className={cn("text-xs", selected ? "text-slate-900 font-semibold" : "text-slate-600 group-hover:text-slate-900")}>{label}</span>
        </label>
    );
}

function countActive(filters: FilterState): number {
    let c = 0;
    if (filters.marketplace_id) c++;
    if (filters.statusExterno.length > 0) c++;
    if (filters.mapeoFilter !== 'all') c++;
    if (filters.brands.length > 0) c++;
    if (filters.domainIds.length > 0) c++;
    if (filters.listingTypes.length > 0) c++;
    if (filters.logisticTypes.length > 0) c++;
    if (filters.freeShipping !== null) c++;
    if (filters.healthRange) c++;
    if (filters.condition) c++;
    if (filters.priceMin !== null || filters.priceMax !== null) c++;
    if (filters.salesRange) c++;
    if (filters.stockRange) c++;
    return c;
}

export function FiltersSidebar({ filters, onChange, facets, marketplaces }: FiltersSidebarProps) {
    const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });

    const toggleArr = <T extends string>(arr: T[], val: T): T[] =>
        arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val];

    const active = countActive(filters);

    const listingTypeLabels: Record<string, string> = {
        gold_special: 'Premium',
        gold_pro: 'Pro',
        gold_premium: 'Clásica',
        free: 'Gratuita',
    };

    const logisticLabels: Record<string, string> = {
        fulfillment: 'Full',
        xd_drop_off: 'XD Drop-off',
        drop_off: 'Drop-off',
        cross_docking: 'Cross-Docking',
        self_service: 'Self Service',
    };

    return (
        <div className="w-64 shrink-0 bg-white rounded-xl border border-slate-200 shadow-sm overflow-y-auto max-h-[calc(100vh-200px)] sticky top-4">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4 text-slate-500" />
                    <span className="text-sm font-bold text-slate-800">Filtros</span>
                    {active > 0 && (
                        <span className="bg-indigo-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{active}</span>
                    )}
                </div>
                {active > 0 && (
                    <button
                        onClick={() => onChange({ ...defaultFilters })}
                        className="text-xs text-slate-400 hover:text-rose-500 flex items-center gap-1 transition-colors"
                    >
                        <X className="w-3 h-3" /> Limpiar
                    </button>
                )}
            </div>

            <div className="px-3 py-2">
                {/* Vidriera (cuenta de MeLi) */}
                {marketplaces.length > 1 && (
                    <Accordion title="Vidriera" defaultOpen>
                        <RadioItem
                            label="Todas"
                            selected={filters.marketplace_id === null}
                            onChange={() => set({ marketplace_id: null })}
                        />
                        {marketplaces.map(m => (
                            <label key={m.id} className="flex items-center justify-between gap-2 group cursor-pointer">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        checked={filters.marketplace_id === m.id}
                                        onChange={() => set({ marketplace_id: m.id })}
                                        className="w-3.5 h-3.5 text-indigo-600 border-slate-300 focus:ring-indigo-500"
                                    />
                                    <span className={cn('text-xs', filters.marketplace_id === m.id ? 'text-slate-900 font-semibold' : 'text-slate-600 group-hover:text-slate-900')}>
                                        {m.account_name}
                                    </span>
                                </div>
                                {m.count !== undefined && (
                                    <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{m.count.toLocaleString()}</span>
                                )}
                            </label>
                        ))}
                    </Accordion>
                )}

                {/* Ordenar */}
                <Accordion title="Ordenar por" defaultOpen>
                    <select
                        value={filters.sortBy}
                        onChange={e => set({ sortBy: e.target.value as FilterState['sortBy'] })}
                        className="w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                    >
                        <option value="creado_el">Fecha de creación</option>
                        <option value="titulo">Título</option>
                        <option value="precio_venta">Precio</option>
                        <option value="sold_quantity">Ventas</option>
                        <option value="health">Salud</option>
                        <option value="stock_publicado">Stock</option>
                    </select>
                    <div className="flex gap-2 mt-1.5">
                        {(['desc', 'asc'] as const).map(d => (
                            <button
                                key={d}
                                onClick={() => set({ sortDir: d })}
                                className={cn("flex-1 text-xs py-1 rounded border transition-colors", filters.sortDir === d ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300")}
                            >
                                {d === 'desc' ? '↓ Mayor' : '↑ Menor'}
                            </button>
                        ))}
                    </div>
                </Accordion>

                {/* Estado */}
                <Accordion title="Estado en MeLi" defaultOpen>
                    {['active', 'paused', 'closed', 'under_review'].map(s => (
                        <CheckItem
                            key={s}
                            label={s === 'active' ? 'Activa' : s === 'paused' ? 'Pausada' : s === 'closed' ? 'Cerrada' : 'En revisión'}
                            checked={filters.statusExterno.includes(s)}
                            onChange={() => set({ statusExterno: toggleArr(filters.statusExterno, s) })}
                        />
                    ))}
                </Accordion>

                {/* Mapeo */}
                <Accordion title="Mapeo a Bodega" defaultOpen>
                    {(['all', 'mapped', 'unmapped'] as const).map(m => (
                        <RadioItem
                            key={m}
                            label={m === 'all' ? 'Todos' : m === 'mapped' ? 'Solo mapeados' : 'Sin mapear'}
                            selected={filters.mapeoFilter === m}
                            onChange={() => set({ mapeoFilter: m })}
                        />
                    ))}
                </Accordion>

                {/* Logística */}
                <Accordion title="Logística">
                    {Object.entries(logisticLabels).map(([val, label]) => (
                        <CheckItem
                            key={val}
                            label={label}
                            checked={filters.logisticTypes.includes(val)}
                            onChange={() => set({ logisticTypes: toggleArr(filters.logisticTypes, val) })}
                        />
                    ))}
                    <CheckItem
                        label="Envío Gratis"
                        checked={filters.freeShipping === true}
                        onChange={() => set({ freeShipping: filters.freeShipping === true ? null : true })}
                    />
                </Accordion>

                {/* Tipo de publicación */}
                <Accordion title="Tipo de Publicación">
                    {Object.entries(listingTypeLabels).map(([val, label]) => (
                        <CheckItem
                            key={val}
                            label={label}
                            checked={filters.listingTypes.includes(val)}
                            onChange={() => set({ listingTypes: toggleArr(filters.listingTypes, val) })}
                        />
                    ))}
                </Accordion>

                {/* Salud */}
                <Accordion title="Salud">
                    {[
                        { val: 'high', label: 'Alta (>70%)' },
                        { val: 'medium', label: 'Media (40-70%)' },
                        { val: 'low', label: 'Baja (<40%)' },
                        { val: 'none', label: 'Sin datos' },
                    ].map(({ val, label }) => (
                        <RadioItem
                            key={val}
                            label={label}
                            selected={filters.healthRange === val}
                            onChange={() => set({ healthRange: filters.healthRange === val ? null : val as FilterState['healthRange'] })}
                        />
                    ))}
                </Accordion>

                {/* Ventas */}
                <Accordion title="Ventas (acumuladas)">
                    {[
                        { val: '0', label: 'Sin ventas' },
                        { val: '1-10', label: '1 a 10' },
                        { val: '11-50', label: '11 a 50' },
                        { val: '50+', label: 'Más de 50' },
                    ].map(({ val, label }) => (
                        <RadioItem
                            key={val}
                            label={label}
                            selected={filters.salesRange === val}
                            onChange={() => set({ salesRange: filters.salesRange === val ? null : val as FilterState['salesRange'] })}
                        />
                    ))}
                </Accordion>

                {/* Stock */}
                <Accordion title="Stock en MeLi">
                    {[
                        { val: '0', label: 'Sin stock' },
                        { val: '1-5', label: '1 a 5' },
                        { val: '6-20', label: '6 a 20' },
                        { val: '20+', label: 'Más de 20' },
                    ].map(({ val, label }) => (
                        <RadioItem
                            key={val}
                            label={label}
                            selected={filters.stockRange === val}
                            onChange={() => set({ stockRange: filters.stockRange === val ? null : val as FilterState['stockRange'] })}
                        />
                    ))}
                </Accordion>

                {/* Condición */}
                <Accordion title="Condición">
                    <RadioItem label="Nuevo" selected={filters.condition === 'new'} onChange={() => set({ condition: filters.condition === 'new' ? null : 'new' })} />
                    <RadioItem label="Usado" selected={filters.condition === 'used'} onChange={() => set({ condition: filters.condition === 'used' ? null : 'used' })} />
                </Accordion>

                {/* Precio */}
                <Accordion title="Rango de Precio">
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            placeholder="Min"
                            value={filters.priceMin ?? ''}
                            onChange={e => set({ priceMin: e.target.value ? Number(e.target.value) : null })}
                            className="w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 focus:ring-indigo-500"
                        />
                        <span className="text-slate-400 text-xs">–</span>
                        <input
                            type="number"
                            placeholder="Max"
                            value={filters.priceMax ?? ''}
                            onChange={e => set({ priceMax: e.target.value ? Number(e.target.value) : null })}
                            className="w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 focus:ring-indigo-500"
                        />
                    </div>
                </Accordion>

                {/* Top Marcas */}
                {facets.brands.length > 0 && (
                    <Accordion title={`Marca (top ${facets.brands.length})`}>
                        {facets.brands.map(b => (
                            <CheckItem
                                key={b.value}
                                label={b.label}
                                count={b.count}
                                checked={filters.brands.includes(b.value)}
                                onChange={() => set({ brands: toggleArr(filters.brands, b.value) })}
                            />
                        ))}
                    </Accordion>
                )}

                {/* Top Dominios */}
                {facets.domains.length > 0 && (
                    <Accordion title={`Categoría (top ${facets.domains.length})`}>
                        {facets.domains.map(d => (
                            <CheckItem
                                key={d.value}
                                label={d.label}
                                count={d.count}
                                checked={filters.domainIds.includes(d.value)}
                                onChange={() => set({ domainIds: toggleArr(filters.domainIds, d.value) })}
                            />
                        ))}
                    </Accordion>
                )}
            </div>
        </div>
    );
}
