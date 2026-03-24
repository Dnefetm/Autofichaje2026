"use client";

import { useState, useEffect, useCallback } from "react";
import {
    ShoppingCart, CheckCircle2, XCircle, Clock, Loader2,
    RefreshCw, ChevronDown, ChevronUp,
    Truck, Package, Store, Printer, Box, Warehouse
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ───── Types ───── */
interface VariationAttr { id: string; name: string; value_name: string; }
interface Reservacion { id: string; cantidad: number; estado: "activa" | "consumida" | "liberada"; }
interface OrdenItem {
    id: string; meli_item_id: string; meli_variation_id: string;
    titulo: string | null; quantity: number; unit_price: number;
    full_unit_price: number | null; seller_sku: string | null;
    articulo_id: string | null; publicacion_id: string | null;
    variation_attributes: VariationAttr[];
    reservaciones_stock: Reservacion[];
}
interface Orden {
    id: string; meli_order_id: number; status: string;
    date_created: string; date_closed: string | null;
    buyer_id: number; buyer_nickname: string | null;
    buyer_first_name: string | null; buyer_last_name: string | null;
    total_amount: number; paid_amount: number | null; currency_id: string;
    shipping_id: number | null; shipping_logistic_type: string | null;
    shipping_status: string; tags: string[]; marketplace_id: string;
    buying_mode: string | null; pack_id: number | null;
    store_name: string; orden_items: OrdenItem[];
}

/* ───── Config maps ───── */
const STATUS_CFG: Record<string, { label: string; color: string; Icon: any }> = {
    paid:               { label: "Pagada",          color: "bg-emerald-100 text-emerald-700", Icon: CheckCircle2 },
    cancelled:          { label: "Cancelada",       color: "bg-rose-100 text-rose-700",       Icon: XCircle },
    confirmed:          { label: "Confirmada",      color: "bg-blue-100 text-blue-700",       Icon: Clock },
    payment_in_process: { label: "Procesando pago", color: "bg-amber-100 text-amber-700",     Icon: Clock },
};

const SHIP_CFG: Record<string, { label: string; color: string; Icon: any }> = {
    pending:       { label: "Etiqueta por imprimir", color: "bg-yellow-100 text-yellow-800", Icon: Printer },
    ready_to_ship: { label: "Etiqueta impresa",     color: "bg-orange-100 text-orange-700", Icon: Printer },
    not_delivered: { label: "En camino",             color: "bg-blue-100 text-blue-700",     Icon: Truck },
    shipped:       { label: "Enviado",               color: "bg-indigo-100 text-indigo-700", Icon: Package },
    delivered:     { label: "Entregado",             color: "bg-emerald-100 text-emerald-700", Icon: CheckCircle2 },
};

const LOGISTIC_CFG: Record<string, { label: string; color: string; Icon: any }> = {
    fulfillment:  { label: "Full",       color: "bg-purple-100 text-purple-700", Icon: Warehouse },
    xd_drop_off:  { label: "Agencia",    color: "bg-sky-100 text-sky-700",       Icon: Package },
    self_service: { label: "Flex",       color: "bg-teal-100 text-teal-700",     Icon: Truck },
    drop_off:     { label: "Drop off",   color: "bg-slate-100 text-slate-600",   Icon: Box },
    custom:       { label: "Personalizado", color: "bg-slate-100 text-slate-600", Icon: Box },
};

const STATUS_FILTERS = [
    { value: "", label: "Todas" }, { value: "paid", label: "Pagadas" },
    { value: "cancelled", label: "Canceladas" }, { value: "confirmed", label: "Confirmadas" },
];

/* ───── Small components ───── */
function Badge({ label, color, Icon }: { label: string; color: string; Icon?: any }) {
    return (
        <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap", color)}>
            {Icon && <Icon size={12} />}{label}
        </span>
    );
}

function variantText(attrs: VariationAttr[]): string {
    if (!attrs || attrs.length === 0) return "";
    return attrs.map(a => a.value_name).join(" / ");
}

function fmtDate(iso: string) {
    return new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function fmtMoney(n: number) {
    return "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2 });
}

function logisticLabel(type: string | null) {
    if (!type) return LOGISTIC_CFG.custom;
    return LOGISTIC_CFG[type] || { label: type, color: "bg-slate-100 text-slate-600", Icon: Box };
}

/* ───── Detail Panel (shown when row expanded) ───── */
function DetailPanel({ orden }: { orden: Orden }) {
    const sc = STATUS_CFG[orden.status] || { label: orden.status, color: "bg-slate-100 text-slate-600", Icon: Clock };
    const shc = SHIP_CFG[orden.shipping_status] || { label: orden.shipping_status, color: "bg-slate-100 text-slate-500", Icon: Box };
    const lc = logisticLabel(orden.shipping_logistic_type);
    return (
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 space-y-4 text-sm">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div><span className="text-slate-400 text-xs">Orden MeLi</span><p className="font-bold">#{orden.meli_order_id}</p></div>
                <div><span className="text-slate-400 text-xs">Tienda</span><p className="font-bold">{orden.store_name}</p></div>
                <div><span className="text-slate-400 text-xs">Fecha</span><p>{fmtDate(orden.date_created)}</p></div>
                <div><span className="text-slate-400 text-xs">Total</span><p className="font-bold">{fmtMoney(orden.total_amount)} {orden.currency_id}</p></div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div><span className="text-slate-400 text-xs">Estado pago</span><div className="mt-1"><Badge label={sc.label} color={sc.color} Icon={sc.Icon} /></div></div>
                <div><span className="text-slate-400 text-xs">Estado envío</span><div className="mt-1"><Badge label={shc.label} color={shc.color} Icon={shc.Icon} /></div></div>
                <div><span className="text-slate-400 text-xs">Logística</span><div className="mt-1"><Badge label={lc.label} color={lc.color} Icon={lc.Icon} /></div></div>
                <div><span className="text-slate-400 text-xs">Comprador</span><p>{orden.buyer_nickname || `${orden.buyer_first_name || ""} ${orden.buyer_last_name || ""}`.trim() || String(orden.buyer_id)}</p></div>
            </div>
            {orden.pack_id && <p className="text-xs text-slate-400">Pack ID: {orden.pack_id}</p>}
            {/* Items detail table */}
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead><tr className="text-slate-400 border-b">
                        <th className="text-left py-1 pr-3">Artículo</th>
                        <th className="text-left py-1 pr-3">Variante</th>
                        <th className="text-left py-1 pr-3">SKU</th>
                        <th className="text-right py-1 pr-3">Cant</th>
                        <th className="text-right py-1 pr-3">P. Unit</th>
                        <th className="text-right py-1 pr-3">Subtotal</th>
                        <th className="text-left py-1">Reservación</th>
                    </tr></thead>
                    <tbody>
                    {orden.orden_items.map(it => (
                        <tr key={it.id} className="border-b border-slate-100">
                            <td className="py-1.5 pr-3 max-w-[250px] truncate">{it.titulo || it.meli_item_id}</td>
                            <td className="py-1.5 pr-3">{variantText(it.variation_attributes) || "—"}</td>
                            <td className="py-1.5 pr-3 font-mono text-[11px]">{it.seller_sku || "—"}</td>
                            <td className="py-1.5 pr-3 text-right">{it.quantity}</td>
                            <td className="py-1.5 pr-3 text-right">{fmtMoney(it.unit_price)}</td>
                            <td className="py-1.5 pr-3 text-right font-medium">{fmtMoney(it.unit_price * it.quantity)}</td>
                            <td className="py-1.5">
                                {it.reservaciones_stock.length > 0
                                    ? it.reservaciones_stock.map(r => (
                                        <span key={r.id} className={cn("inline-block mr-1 px-1.5 py-0.5 rounded text-[10px] font-semibold",
                                            r.estado === "activa" ? "bg-amber-100 text-amber-700" :
                                            r.estado === "consumida" ? "bg-slate-100 text-slate-500" : "bg-rose-100 text-rose-500"
                                        )}>{r.estado} ({r.cantidad})</span>
                                    ))
                                    : <span className="text-slate-300">—</span>}
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/* ───── Main page ───── */
export default function VentasPage() {
    const [ordenes, setOrdenes] = useState<Orden[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const [offset, setOffset] = useState(0);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const LIMIT = 30;

    const fetchOrdenes = useCallback(async (off = 0, status = "") => {
        setLoading(true); setError("");
        try {
            const p = new URLSearchParams({ limit: String(LIMIT), offset: String(off) });
            if (status) p.set("status", status);
            const res = await fetch(`/api/ventas?${p}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            setOrdenes(json.data || []); setTotal(json.total || 0);
        } catch (e: any) { setError(e.message); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchOrdenes(0, statusFilter); }, [fetchOrdenes, statusFilter]);

    /* Flatten ordenes into item-rows for the table */
    const rows = ordenes.flatMap(o =>
        o.orden_items.map(it => ({ orden: o, item: it }))
    );

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Ventas</h2>
                    <p className="text-sm text-slate-400">
                        {total > 0 ? `${total} órdenes de MercadoLibre` : "Órdenes y reservaciones de stock"}
                    </p>
                </div>
                <button onClick={() => fetchOrdenes(offset, statusFilter)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 shadow-sm">
                    <RefreshCw size={14} /> Actualizar
                </button>
            </div>

            {/* Filters */}
            <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
                {STATUS_FILTERS.map(f => (
                    <button key={f.value} onClick={() => { setStatusFilter(f.value); setOffset(0); setExpandedId(null); }}
                        className={cn("px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
                            statusFilter === f.value ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        )}>{f.label}</button>
                ))}
            </div>

            {/* States */}
            {loading && <div className="flex justify-center py-20"><Loader2 className="animate-spin text-slate-300" size={32} /></div>}
            {error && <div className="text-center py-10 text-rose-500 font-bold">{error}</div>}
            {!loading && !error && rows.length === 0 && (
                <div className="text-center py-20 text-slate-400">
                    <ShoppingCart size={40} className="mx-auto mb-3 opacity-30" />
                    <h3 className="font-bold text-lg">Sin órdenes aún</h3>
                    <p className="text-sm">Las órdenes aparecerán aquí cuando MercadoLibre envíe notificaciones.</p>
                </div>
            )}

            {/* Data table — 4 columns */}
            {!loading && !error && rows.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                                    <th className="text-left px-4 py-3 font-semibold w-[220px]">Venta</th>
                                    <th className="text-left px-3 py-3 font-semibold">Artículo</th>
                                    <th className="text-right px-3 py-3 font-semibold w-[100px]">Cant / Monto</th>
                                    <th className="text-left px-3 py-3 font-semibold w-[180px]">Estado</th>
                                    <th className="px-2 py-3 w-8"></th>
                                </tr>
                            </thead>
                            <tbody>
                            {rows.map(({ orden: o, item: it }, idx) => {
                                const isExpanded = expandedId === o.id;
                                const sc = STATUS_CFG[o.status] || { label: o.status, color: "bg-slate-100 text-slate-600", Icon: Clock };
                                const shc = SHIP_CFG[o.shipping_status] || { label: o.shipping_status, color: "bg-slate-100 text-slate-500", Icon: Box };
                                const lc = logisticLabel(o.shipping_logistic_type);
                                const isFirstItem = idx === 0 || rows[idx - 1].orden.id !== o.id;
                                const itemCount = o.orden_items.length;
                                const vt = variantText(it.variation_attributes);
                                return (
                                    <>
                                    <tr key={it.id}
                                        className={cn(
                                            "border-b border-slate-100 hover:bg-slate-50/50 transition-colors cursor-pointer",
                                            isExpanded && "bg-indigo-50/30"
                                        )}
                                        onClick={() => setExpandedId(isExpanded ? null : o.id)}>
                                        {/* Col 1: Venta — Pack ID, #Orden, Tienda */}
                                        {isFirstItem ? (
                                            <td className="px-4 py-2.5 align-top" rowSpan={itemCount}>
                                                <div className="space-y-0.5">
                                                    {o.pack_id && (
                                                        <p className="text-xs font-bold text-indigo-600">Pack {o.pack_id}</p>
                                                    )}
                                                    <p className={cn("font-bold", o.pack_id ? "text-[11px] text-slate-500" : "text-sm text-indigo-600")}>
                                                        #{o.meli_order_id}
                                                    </p>
                                                    <p className="text-[11px] text-slate-400">{fmtDate(o.date_created)}</p>
                                                    <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full mt-1",
                                                        o.store_name === "Histofarma" ? "bg-teal-100 text-teal-700" : "bg-violet-100 text-violet-700"
                                                    )}>
                                                        <Store size={10} />{o.store_name}
                                                    </span>
                                                </div>
                                            </td>
                                        ) : null}
                                        {/* Col 2: Artículo — nombre, variante, SKU */}
                                        <td className="px-3 py-2.5 align-top">
                                            <div>
                                                <p className="font-medium text-slate-800 leading-tight" title={it.titulo || ""}>
                                                    {it.titulo || it.meli_item_id}
                                                </p>
                                                {vt && <p className="text-[11px] text-slate-500 mt-0.5">{vt}</p>}
                                                <p className="text-[11px] text-slate-400 font-mono mt-0.5">{it.seller_sku || "—"}</p>
                                            </div>
                                        </td>
                                        {/* Col 3: Cantidad + Monto */}
                                        <td className="px-3 py-2.5 text-right align-top">
                                            <p className="font-bold text-slate-800">{it.quantity}</p>
                                            <p className="text-[11px] text-slate-500">{fmtMoney(it.unit_price * it.quantity)}</p>
                                        </td>
                                        {/* Col 4: Estado — logística, pago, envío (order-level) */}
                                        {isFirstItem ? (
                                            <td className="px-3 py-2.5 align-top" rowSpan={itemCount}>
                                                <div className="flex flex-col gap-1">
                                                    <Badge label={lc.label} color={lc.color} Icon={lc.Icon} />
                                                    <Badge label={sc.label} color={sc.color} Icon={sc.Icon} />
                                                    <Badge label={shc.label} color={shc.color} Icon={shc.Icon} />
                                                </div>
                                            </td>
                                        ) : null}
                                        {/* Chevron */}
                                        {isFirstItem ? (
                                            <td className="px-2 py-2.5 text-center align-top" rowSpan={itemCount}>
                                                {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                            </td>
                                        ) : null}
                                    </tr>
                                    {isExpanded && isFirstItem && (
                                        <tr key={`detail-${o.id}`}>
                                            <td colSpan={5}>
                                                <DetailPanel orden={o} />
                                            </td>
                                        </tr>
                                    )}
                                    </>
                                );
                            })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Pagination */}
            {total > LIMIT && (
                <div className="flex items-center justify-between pt-2">
                    <p className="text-xs text-slate-400">Mostrando {offset + 1}–{Math.min(offset + LIMIT, total)} de {total}</p>
                    <div className="flex gap-2">
                        <button onClick={() => { const o = Math.max(0, offset - LIMIT); setOffset(o); fetchOrdenes(o, statusFilter); }}
                            disabled={offset === 0}
                            className="px-4 py-1.5 text-xs font-bold bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40">
                            ← Anterior
                        </button>
                        <button onClick={() => { const o = offset + LIMIT; setOffset(o); fetchOrdenes(o, statusFilter); }}
                            disabled={offset + LIMIT >= total}
                            className="px-4 py-1.5 text-xs font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40">
                            Siguiente →
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
