"use client";

import { useState, useEffect, useCallback } from 'react';
import {
    ShoppingCart, Package, Lock, CheckCircle2,
    XCircle, Clock, Loader2, AlertTriangle, RefreshCw,
    ChevronDown, ChevronUp, Truck
} from 'lucide-react';
import { cn } from '@/lib/utils';

type OrdenStatus = 'paid' | 'cancelled' | 'confirmed' | 'payment_in_process' | string;

interface Reservacion {
    id: string;
    cantidad: number;
    estado: 'activa' | 'consumida' | 'liberada';
}

interface OrdenItem {
    id: string;
    meli_item_id: string;
    meli_variation_id: string;
    titulo: string | null;
    quantity: number;
    unit_price: number;
    seller_sku: string | null;
    articulo_id: string | null;
    publicacion_id: string | null;
    reservaciones_stock: Reservacion[];
}

interface Orden {
    id: string;
    meli_order_id: number;
    status: OrdenStatus;
    date_created: string;
    date_closed: string | null;
    buyer_id: number;
    total_amount: number;
    paid_amount: number | null;
    currency_id: string;
    shipping_logistic_type: string | null;
    tags: string[];
    marketplace_id: string;
    orden_items: OrdenItem[];
}

const STATUS_LABELS: Record<string, { label: string; color: string; Icon: any }> = {
    paid:                  { label: 'Pagada',           color: 'bg-emerald-100 text-emerald-700', Icon: CheckCircle2 },
    cancelled:             { label: 'Cancelada',        color: 'bg-rose-100 text-rose-700',       Icon: XCircle },
    confirmed:             { label: 'Confirmada',       color: 'bg-blue-100 text-blue-700',       Icon: Clock },
    payment_in_process:    { label: 'Procesando pago', color: 'bg-amber-100 text-amber-700',     Icon: Clock },
    payment_required:      { label: 'Pago pendiente',  color: 'bg-amber-100 text-amber-700',     Icon: Clock },
    partially_paid:        { label: 'Pago parcial',    color: 'bg-orange-100 text-orange-700',   Icon: AlertTriangle },
};

const ESTADO_RESERVACION: Record<string, string> = {
    activa:   'bg-amber-100 text-amber-700',
    consumida:'bg-slate-100 text-slate-500',
    liberada: 'bg-rose-100 text-rose-500',
};

function StatusBadge({ status }: { status: OrdenStatus }) {
    const cfg = STATUS_LABELS[status] || { label: status, color: 'bg-slate-100 text-slate-600', Icon: Clock };
    return (
        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold', cfg.color)}>
            <cfg.Icon className="w-3 h-3" />
            {cfg.label}
        </span>
    );
}

function LogisticBadge({ type }: { type: string | null }) {
    if (!type) return null;
    const isFull = type === 'fulfillment';
    return (
        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
            isFull ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600')}>
            <Truck className="w-3 h-3" />
            {isFull ? 'Full' : type}
        </span>
    );
}

function OrdenRow({ orden }: { orden: Orden }) {
    const [expanded, setExpanded] = useState(false);
    const totalReservaciones = orden.orden_items.reduce(
        (sum, item) => sum + item.reservaciones_stock.filter(r => r.estado === 'activa').length, 0
    );

    return (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
            <button
                onClick={() => setExpanded(e => !e)}
                className="w-full text-left p-4 flex items-center gap-4"
            >
                <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                    <ShoppingCart className="w-5 h-5 text-indigo-600" />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-sm text-slate-800">#{orden.meli_order_id}</span>
                        <StatusBadge status={orden.status} />
                        <LogisticBadge type={orden.shipping_logistic_type} />
                        {totalReservaciones > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
                                <Lock className="w-3 h-3" />
                                {totalReservaciones} reserv.
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                        {new Date(orden.date_created).toLocaleString('es-MX')} · {orden.orden_items.length} artículo(s)
                    </p>
                </div>

                <div className="text-right shrink-0">
                    <p className="font-bold text-slate-800">${orden.total_amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</p>
                    <p className="text-xs text-slate-400">{orden.currency_id}</p>
                </div>

                <div className="text-slate-400 shrink-0">
                    {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
            </button>

            {expanded && (
                <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-2 animate-in slide-in-from-top-2 duration-200">
                    {orden.orden_items.map(item => (
                        <div key={item.id} className="flex items-start gap-3 rounded-lg bg-slate-50 px-3 py-2">
                            <Package className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-800 truncate">{item.titulo || item.meli_item_id}</p>
                                <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500 flex-wrap">
                                    <span>Cant: <strong>{item.quantity}</strong></span>
                                    <span>Precio unit: <strong>${item.unit_price.toLocaleString('es-MX')}</strong></span>
                                    {item.seller_sku && <span className="font-mono bg-slate-200 px-1 rounded">{item.seller_sku}</span>}
                                    {item.articulo_id
                                        ? <span className="text-emerald-600 font-medium">✓ Mapeado</span>
                                        : <span className="text-rose-500">Sin mapeo</span>
                                    }
                                </div>
                            </div>
                            <div className="space-y-1 shrink-0">
                                {item.reservaciones_stock.map(r => (
                                    <span key={r.id} className={cn('block text-xs px-2 py-0.5 rounded-full font-bold text-center', ESTADO_RESERVACION[r.estado])}>
                                        {r.estado} ({r.cantidad})
                                    </span>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

const STATUS_FILTERS = [
    { value: '',          label: 'Todas' },
    { value: 'paid',      label: 'Pagadas' },
    { value: 'cancelled', label: 'Canceladas' },
    { value: 'confirmed', label: 'Confirmadas' },
];

export default function VentasPage() {
    const [ordenes, setOrdenes] = useState<Orden[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [offset, setOffset] = useState(0);
    const LIMIT = 20;

    const fetchOrdenes = useCallback(async (off = 0, status = '') => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({ limit: String(LIMIT), offset: String(off) });
            if (status) params.set('status', status);
            const res = await fetch(`/api/ventas?${params}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            setOrdenes(json.data || []);
            setTotal(json.total || 0);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchOrdenes(0, statusFilter); }, [fetchOrdenes, statusFilter]);

    return (
        <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-end justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900">Ventas</h2>
                    <p className="text-slate-500 text-sm">
                        {total > 0 ? `${total.toLocaleString()} órdenes de MercadoLibre` : 'Órdenes y reservaciones de stock'}
                    </p>
                </div>
                <button
                    onClick={() => fetchOrdenes(offset, statusFilter)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-sm"
                >
                    <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
                    Actualizar
                </button>
            </div>

            {/* Filtros */}
            <div className="flex gap-2 bg-slate-100 p-1 rounded-xl w-fit">
                {STATUS_FILTERS.map(f => (
                    <button
                        key={f.value}
                        onClick={() => { setStatusFilter(f.value); setOffset(0); }}
                        className={cn(
                            'px-4 py-1.5 rounded-lg text-xs font-bold transition-all',
                            statusFilter === f.value
                                ? 'bg-white text-indigo-600 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                        )}
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            {/* Estados */}
            {loading && (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
                </div>
            )}

            {error && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                    <p className="text-rose-700 text-sm font-medium">{error}</p>
                </div>
            )}

            {!loading && !error && ordenes.length === 0 && (
                <div className="bg-white border border-slate-200 rounded-2xl p-16 flex flex-col items-center gap-3 text-center">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
                        <ShoppingCart className="w-8 h-8 text-slate-400" />
                    </div>
                    <h3 className="font-bold text-slate-700">Sin órdenes aún</h3>
                    <p className="text-sm text-slate-400 max-w-xs">
                        Las órdenes aparecerán aquí cuando MercadoLibre envíe notificaciones al webhook.
                    </p>
                </div>
            )}

            {!loading && ordenes.length > 0 && (
                <div className="space-y-3">
                    {ordenes.map(orden => <OrdenRow key={orden.id} orden={orden} />)}
                </div>
            )}

            {/* Paginación */}
            {total > LIMIT && (
                <div className="flex items-center justify-between pt-2">
                    <p className="text-xs text-slate-400">
                        Mostrando {offset + 1}–{Math.min(offset + LIMIT, total)} de {total}
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => { const o = Math.max(0, offset - LIMIT); setOffset(o); fetchOrdenes(o, statusFilter); }}
                            disabled={offset === 0}
                            className="px-4 py-1.5 text-xs font-bold bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            ← Anterior
                        </button>
                        <button
                            onClick={() => { const o = offset + LIMIT; setOffset(o); fetchOrdenes(o, statusFilter); }}
                            disabled={offset + LIMIT >= total}
                            className="px-4 py-1.5 text-xs font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Siguiente →
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
