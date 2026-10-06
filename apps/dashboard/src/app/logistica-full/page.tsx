"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Page } from '@/components/ui/Page';
import { PageHeader } from '@/components/ui/PageHeader';
import { Btn } from '@/components/ui/Btn';
import { Card } from '@/components/ui/Card';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { RefreshCw, PackageSearch, Truck, Boxes, Download, Upload } from 'lucide-react';
import { toast } from 'sonner';

interface PropItem {
    marketplace_id: string;
    cuenta: string;
    inventory_id: string;
    nombre: string | null;
    articulo_id: string;
    seller_sku: string | null;
    codigo_universal: string | null;
    ventas_ultimo_mes: number;
    stock_full: number;
    stock_bodega: number | null;
    stock_disponible: number | null;
    pendientes: number | null;
    stock_efectivo: number;
    cobertura_dias: number | null;
    sugerido: number;
    sugerencia_ml: number | null;
    shipping_urgency: string | null;
}

interface PropData {
    cobertura_deseada: number;
    metodo: string;
    dias_ventana: number;
    total_items: number;
    requieren_envio: number;
    total_sugerido: number;
    propuesta: PropItem[];
}

interface Envio {
    guia: string;
    estado: 'Pendiente' | 'Reunido' | 'Preparado';
    count: number;
    cantidad: number;
    pendiente: number;
    reunido: number;
    preparado: number;
    fecha: string;
}

export default function LogisticaFullPage() {
    const [data, setData] = useState<PropData | null>(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [envios, setEnvios] = useState<Envio[]>([]);
    const [avanzandoGuia, setAvanzandoGuia] = useState<string | null>(null);
    const [cobertura, setCobertura] = useState(30);
    const [metodo, setMetodo] = useState<'ultimo_mes' | 'historico_promedio' | 'historico_mediana' | 'hibrido'>('hibrido');
    const [cuentas, setCuentas] = useState<{ id: string; nombre: string }[]>([]);
    const [cuenta, setCuenta] = useState<string>('');
    const [busqueda, setBusqueda] = useState('');
    const [importando, setImportando] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    // --- Envíos planificados (decisión del operario) ---
    const [planes, setPlanes] = useState<any[]>([]);
    const [planAbierto, setPlanAbierto] = useState<{ id: string; estado: string; notas: string; items: any[] } | null>(null);
    const [planGuardando, setPlanGuardando] = useState(false);
    const [nuevoCodigo, setNuevoCodigo] = useState('');
    const [nuevoCantidad, setNuevoCantidad] = useState('');
    const [sinMapeo, setSinMapeo] = useState<any[] | null>(null);

    const importarPdf = async (ev: React.ChangeEvent<HTMLInputElement>) => {
        const file = ev.target.files?.[0];
        ev.target.value = '';
        if (!file) return;
        setImportando(true);
        try {
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            const r = await fetch('/api/logistica-full/importar-pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pdfBase64: base64 }),
            });
            const j = await r.json();
            if (j.success) {
                setSinMapeo((j.sin_mapeo || []).length ? j.sin_mapeo : null);
                const sm = (j.sin_mapeo || []).length;
                toast.success(`PDF ${j.guia} importado: ${j.salidas_generadas} salidas${sm ? ` · ${sm} sin mapeo` : ''}`);
                await loadEnvios();
            } else {
                toast.error(j.error || 'Error importando PDF');
            }
        } catch (e: any) {
            toast.error(e.message || 'Error leyendo el PDF');
        } finally {
            setImportando(false);
        }
    };

    const loadCuentas = useCallback(async () => {
        try {
            const sb = supabaseBrowser();
            const { data } = await sb.from('marketplace_configs').select('id, account_name, settings').eq('is_active', true);
            setCuentas((data || []).map((c: any) => ({ id: c.id, nombre: c.settings?.store_name || c.account_name || c.id })));
        } catch (e) {
            console.error(e);
        }
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const q = new URLSearchParams({ cobertura: String(cobertura), metodo });
            if (cuenta) q.set('cuenta', cuenta);
            const r = await fetch(`/api/logistica-full/propuesta?${q.toString()}`);
            const j = await r.json();
            if (j.success) setData(j);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [cobertura, metodo, cuenta]);

    useEffect(() => { loadCuentas(); }, [loadCuentas]);

    const loadEnvios = useCallback(async () => {
        try {
            const r = await fetch('/api/logistica-full/lotes');
            const j = await r.json();
            if (j.success) setEnvios(j.envios || []);
        } catch (e) {
            console.error(e);
        }
    }, []);

    useEffect(() => { load(); loadEnvios(); }, [load, loadEnvios]);

    const propuestaFiltrada = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        const rows = data?.propuesta || [];
        if (!q) return rows;
        return rows.filter((p) =>
            [p.inventory_id, p.nombre, p.seller_sku, p.codigo_universal, p.cuenta].some((v) =>
                (v || '').toLowerCase().includes(q)
            )
        );
    }, [data, busqueda]);

    const sync = async () => {
        setSyncing(true);
        try {
            await fetch('/api/logistica-full/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
            await load();
        } catch (e) {
            console.error(e);
        } finally {
            setSyncing(false);
        }
    };

    const exportarCSV = () => {
        if (!data?.propuesta?.length) return;
        const head = ['codigo_ml', 'producto', 'ventas_mes', 'stock_full_aptas', 'pendientes', 'stock_efectivo', 'cobertura_dias', 'a_enviar', 'sugerencia_ml', 'urgencia'];
        const rows = data.propuesta.map((p) => [
            p.inventory_id,
            `"${(p.nombre || '').replace(/"/g, '""')}"`,
            p.ventas_ultimo_mes,
            p.stock_full,
            p.pendientes,
            p.stock_efectivo,
            p.cobertura_dias ?? '',
            p.sugerido,
            p.sugerencia_ml ?? '',
            p.shipping_urgency ?? '',
        ].join(','));
        const csv = [head.join(','), ...rows].join('\n');
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `reposicion-full-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const [detalle, setDetalle] = useState<{ guia: string; egresos: any[] } | null>(null);
    const [detalleLoading, setDetalleLoading] = useState(false);

    const cambiarEstado = async (egresoId: string, accion: 'reunir' | 'preparar' | 'quitar') => {
        setAvanzandoGuia(egresoId);
        try {
            await fetch('/api/logistica-full/envio', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ egreso_id: egresoId, accion }),
            });
            if (detalle) await verEnvio(detalle.guia);
        } catch (e) {
            console.error(e);
        } finally {
            setAvanzandoGuia(null);
        }
    };

    const verEnvio = async (guia: string) => {
        setDetalleLoading(true);
        try {
            const r = await fetch(`/api/logistica-full/envio?guia=${encodeURIComponent(guia)}`);
            const j = await r.json();
            if (j.success) setDetalle({ guia, egresos: j.egresos || [] });
        } catch (e) {
            console.error(e);
        } finally {
            setDetalleLoading(false);
        }
    };

    const ajustarCantidad = async (egresoId: string, cantidad: number) => {
        try {
            await fetch('/api/logistica-full/envio', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ egreso_id: egresoId, cantidad }),
            });
            if (detalle) await verEnvio(detalle.guia);
        } catch (e) {
            console.error(e);
        }
    };

    const loadPlanes = useCallback(async () => {
        try {
            const r = await fetch('/api/logistica-full/planificar');
            const j = await r.json();
            if (j.success) setPlanes(j.envios || []);
        } catch (e) { console.error(e); }
    }, []);

    const crearPlan = async () => {
        if (!data?.propuesta?.length) return;
        setPlanGuardando(true);
        try {
            const items = data.propuesta
                .filter((p: any) => (p.sugerido || 0) > 0)
                .map((p: any) => ({ inventory_id: p.inventory_id, nombre: p.nombre, cantidad: p.sugerido, objetivo: p.sugerido }));
            const r = await fetch('/api/logistica-full/planificar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items }),
            });
            const j = await r.json();
            if (j.success) {
                toast.success('Envío planificado creado');
                setPlanAbierto({ id: j.id, estado: 'borrador', notas: '', items });
                await loadPlanes();
            } else toast.error(j.error || 'Error creando plan');
        } catch (e: any) { toast.error(e.message); } finally { setPlanGuardando(false); }
    };

    const abrirPlan = async (id: string) => {
        const r = await fetch(`/api/logistica-full/planificar?id=${id}`);
        const j = await r.json();
        if (j.success) setPlanAbierto({ id: j.envio.id, estado: j.envio.estado, notas: j.envio.notas || '', items: j.items || [] });
    };

    const guardarPlan = async (accion?: 'confirmar' | 'cerrar') => {
        if (!planAbierto) return;
        setPlanGuardando(true);
        try {
            const items = planAbierto.items.map((it: any) => ({ inventory_id: it.inventory_id, nombre: it.nombre, cantidad: it.cantidad, objetivo: it.objetivo }));
            const r = await fetch('/api/logistica-full/planificar', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: planAbierto.id, accion: accion || 'guardar', items }),
            });
            const j = await r.json();
            if (j.success) {
                toast.success(accion === 'confirmar' ? 'Envío confirmado' : accion === 'cerrar' ? 'Envío cerrado' : 'Guardado');
                await loadPlanes();
                if (accion) setPlanAbierto(null);
            } else toast.error(j.error || 'Error');
        } catch (e: any) { toast.error(e.message); } finally { setPlanGuardando(false); }
    };

    const eliminarPlan = async (id: string) => {
        const r = await fetch(`/api/logistica-full/planificar?id=${id}`, { method: 'DELETE' });
        const j = await r.json();
        if (j.success) { toast.success('Plan descartado'); await loadPlanes(); }
    };

    const ajustarItem = (idx: number, cantidad: number) => {
        if (!planAbierto) return;
        const items = [...planAbierto.items];
        items[idx] = { ...items[idx], cantidad: Math.max(0, cantidad) };
        setPlanAbierto({ ...planAbierto, items });
    };

    const quitarItem = (idx: number) => {
        if (!planAbierto) return;
        setPlanAbierto({ ...planAbierto, items: planAbierto.items.filter((_, i) => i !== idx) });
    };

    const agregarItem = () => {
        const cod = nuevoCodigo.trim();
        const cant = parseInt(nuevoCantidad, 10);
        if (!cod || !Number.isFinite(cant) || cant < 0 || !planAbierto) return;
        setPlanAbierto({ ...planAbierto, items: [...planAbierto.items, { inventory_id: cod, nombre: null, cantidad: cant, objetivo: null }] });
        setNuevoCodigo(''); setNuevoCantidad('');
    };

    useEffect(() => { loadPlanes(); }, [loadPlanes]);

    const columns: Column<PropItem>[] = [
        {
            key: 'nombre',
            label: 'Producto',
            sortValue: (r) => r.nombre || '',
            render: (r) => (
                <div className="min-w-0">
                    <p className="font-medium text-[var(--text)] truncate">{r.nombre || '(sin nombre)'}</p>
                    <p className="text-xs text-[var(--text-faint)] font-mono">{r.inventory_id}{r.seller_sku ? ` · ${r.seller_sku}` : ''}</p>
                    {r.codigo_universal && <p className="text-[11px] text-[var(--text-faint)] font-mono">UPC {r.codigo_universal}</p>}
                    <p className="text-[11px] text-[var(--accent)]">{r.cuenta}</p>
                </div>
            ),
        },
        { key: 'ventas_ultimo_mes', label: 'Ventas mes', align: 'right', sortValue: (r) => r.ventas_ultimo_mes, render: (r) => <span className="font-mono">{r.ventas_ultimo_mes}</span> },
        { key: 'stock_full', label: 'Full (aptas)', align: 'right', sortValue: (r) => r.stock_full, render: (r) => <span className="font-mono">{r.stock_full}</span> },
        {
            key: 'stock_bodega',
            label: 'Stock bodega',
            align: 'right',
            sortValue: (r) => r.stock_bodega ?? -1,
            render: (r) =>
                r.stock_bodega != null ? (
                    <div className="text-right">
                        <span className="font-mono font-semibold">{r.stock_bodega}</span>
                        {r.stock_disponible != null && r.stock_disponible !== r.stock_bodega && (
                            <p className="text-[10px] text-[var(--text-faint)] font-mono">disp {r.stock_disponible}</p>
                        )}
                    </div>
                ) : (
                    <span className="font-mono text-[var(--text-faint)]">—</span>
                ),
        },
        {
            key: 'pendientes',
            label: 'Pendientes',
            align: 'right',
            sortValue: (r) => r.pendientes ?? -1,
            render: (r) => (r.pendientes == null ? <span className="font-mono text-[var(--text-faint)]">—</span> : r.pendientes > 0 ? <span className="font-mono text-[var(--info)]">+{r.pendientes}</span> : <span className="font-mono text-[var(--text-faint)]">0</span>),
        },
        { key: 'stock_efectivo', label: 'Efectivo', align: 'right', sortValue: (r) => r.stock_efectivo, render: (r) => <span className="font-mono font-semibold">{r.stock_efectivo}</span> },
        {
            key: 'cobertura_dias',
            label: 'Cobertura',
            align: 'right',
            sortValue: (r) => r.cobertura_dias ?? -1,
            render: (r) => {
                const bajo = r.cobertura_dias != null && r.cobertura_dias < (data?.cobertura_deseada ?? 30);
                return r.cobertura_dias != null ? (
                    <span className="font-mono" style={{ color: bajo ? 'var(--err)' : 'var(--ok)' }}>{r.cobertura_dias}d</span>
                ) : (
                    <span className="font-mono text-[var(--text-faint)]">—</span>
                );
            },
        },
        {
            key: 'sugerido',
            label: 'A enviar',
            align: 'right',
            sortValue: (r) => r.sugerido,
            render: (r) =>
                r.sugerido > 0 ? (
                    <Badge tone="warning"><Truck className="w-3 h-3" /> {r.sugerido}</Badge>
                ) : (
                    <span className="font-mono text-[var(--text-faint)]">—</span>
                ),
        },
        {
            key: 'sugerencia_ml',
            label: 'ML (ref)',
            align: 'right',
            sortValue: (r) => r.sugerencia_ml ?? -1,
            render: (r) =>
                r.sugerencia_ml != null ? (
                    <span className="font-mono text-[var(--text-faint)]">{r.sugerencia_ml}</span>
                ) : (
                    <span className="font-mono text-[var(--text-faint)]">—</span>
                ),
        },
        {
            key: 'shipping_urgency',
            label: 'Urgencia',
            sortValue: (r) => r.shipping_urgency ?? '',
            render: (r) =>
                r.shipping_urgency ? (
                    <Badge tone={r.shipping_urgency === 'URGENT' || r.shipping_urgency === 'THIS_WEEK' ? 'danger' : 'neutral'}>
                        {r.shipping_urgency}
                    </Badge>
                ) : (
                    <span className="text-[var(--text-faint)]">—</span>
                ),
        },
    ];

    const envioColumns: Column<Envio>[] = [
        { key: 'guia', label: 'Guía', render: (r) => <span className="font-mono font-semibold">{r.guia}</span> },
        {
            key: 'estado',
            label: 'Estado',
            render: (r) => (
                <Badge tone={r.estado === 'Preparado' ? 'success' : r.estado === 'Reunido' ? 'info' : 'neutral'}>
                    {r.estado}
                </Badge>
            ),
        },
        { key: 'count', label: 'Productos', align: 'right', render: (r) => <span className="font-mono">{r.count}</span> },
        { key: 'cantidad', label: 'Total uds', align: 'right', render: (r) => <span className="font-mono">{r.cantidad}</span> },
        { key: 'fecha', label: 'Fecha', render: (r) => (r.fecha ? new Date(r.fecha).toLocaleDateString('es-MX') : '—') },
        {
            key: 'acciones',
            label: '',
            render: (r) => (
                <div className="flex gap-1.5 justify-end">
                    <Btn size="sm" variant="ghost" onClick={() => verEnvio(r.guia)}>
                        Ver productos
                    </Btn>
                </div>
            ),
        },
    ];

    return (
        <Page>
            <PageHeader
                title="Logística Full"
                description="Stock en el depósito Full de MeLi y propuesta de reposición."
                actions={
                    <>
                        <Btn variant="primary" onClick={crearPlan} loading={planGuardando && !planAbierto} icon={<Boxes className="w-4 h-4" />}>
                            Planificar envío
                        </Btn>
                        <Btn variant="outline" onClick={exportarCSV} icon={<Download className="w-4 h-4" />}>
                            Exportar CSV
                        </Btn>
                        <Btn variant="outline" onClick={() => fileRef.current?.click()} loading={importando} icon={<Upload className="w-4 h-4" />}>
                            Importar PDF
                        </Btn>
                        <Btn onClick={sync} loading={syncing} icon={<RefreshCw className="w-4 h-4" />}>
                            Sincronizar stock
                        </Btn>
                        <input
                            ref={fileRef}
                            type="file"
                            accept="application/pdf"
                            className="hidden"
                            onChange={importarPdf}
                        />
                    </>
                }
            />

            {/* Resumen */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Card title="Artículos Full mapeados">
                    <div className="px-4 py-3 flex items-center gap-3">
                        <Boxes className="w-8 h-8 text-[var(--info)]" />
                        <p className="text-2xl font-bold text-[var(--text)]">{data?.total_items ?? '—'}</p>
                    </div>
                </Card>
                <Card title="Requieren envío">
                    <div className="px-4 py-3 flex items-center gap-3">
                        <Truck className="w-8 h-8 text-[var(--warn)]" />
                        <p className="text-2xl font-bold text-[var(--warn)]">{data?.requieren_envio ?? '—'}</p>
                    </div>
                </Card>
                <Card title="Total sugerido (uds)">
                    <div className="px-4 py-3 flex items-center gap-3">
                        <PackageSearch className="w-8 h-8 text-[var(--accent)]" />
                        <p className="text-2xl font-bold text-[var(--accent)]">{data?.total_sugerido ?? '—'}</p>
                    </div>
                </Card>
            </div>

            {/* Productos sin mapeo (tras importar un PDF) */}
            {sinMapeo && sinMapeo.length > 0 && (
                <Card title={`${sinMapeo.length} producto(s) sin mapeo a catálogo`}>
                    <div className="px-4 py-3 space-y-2">
                        <p className="text-xs text-[var(--text-muted)]">
                            Estos códigos del PDF no tienen vidriera mapeada a un artículo, así que no generaron salida. Mápalos en{' '}
                            <a href="/catalog/external" className="text-[var(--accent)] underline">Vitrinas MeLi</a> y vuelve a importar el PDF.
                        </p>
                        <ul className="divide-y divide-[var(--border)]">
                            {sinMapeo.map((p, i) => (
                                <li key={i} className="py-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs items-center">
                                    <span className="font-mono text-[var(--text)]">{p.codigo_ml}</span>
                                    <span className="text-[var(--text-muted)]">{p.titulo || '—'}</span>
                                    {p.sku && <span className="text-[var(--text-faint)]">SKU {p.sku}</span>}
                                    <span className="text-[var(--text-faint)]">×{p.unidades}</span>
                                    {!p.tiene_vidriera && <Badge tone="warning">sin vidriera</Badge>}
                                </li>
                            ))}
                        </ul>
                    </div>
                </Card>
            )}

            {/* Controles */}
            <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                    Cuenta
                    <select
                        value={cuenta}
                        onChange={(e) => setCuenta(e.target.value)}
                        className="px-2 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--text)]"
                    >
                        <option value="">Todas</option>
                        {cuentas.map((c) => (
                            <option key={c.id} value={c.id}>{c.nombre}</option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                    Cobertura deseada (días)
                    <input
                        type="number"
                        min={7}
                        max={60}
                        value={cobertura}
                        onChange={(e) => setCobertura(Number(e.target.value) || 30)}
                        className="w-28 px-2 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--text)]"
                    />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                    Método de proyección
                    <select
                        value={metodo}
                        onChange={(e) => setMetodo(e.target.value as any)}
                        className="px-2 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--text)]"
                    >
                        <option value="hibrido">Híbrido (recomendado)</option>
                        <option value="ultimo_mes">Último mes</option>
                        <option value="historico_promedio">Histórico (promedio 6m)</option>
                        <option value="historico_mediana">Histórico (mediana)</option>
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                    Buscar
                    <input
                        type="search"
                        value={busqueda}
                        onChange={(e) => setBusqueda(e.target.value)}
                        placeholder="Código ML, SKU, UPC o nombre"
                        className="w-56 px-2 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--text)]"
                    />
                </label>
            </div>

            {/* Propuesta */}
            <Card title="Propuesta de reposición">
                <DataTable<PropItem>
                    columns={columns}
                    rows={propuestaFiltrada}
                    rowKey={(r) => `${r.marketplace_id}|${r.inventory_id}`}
                    loading={loading}
                    empty={busqueda.trim() ? 'Sin coincidencias para la búsqueda' : 'Sin artículos Full mapeados'}
                    sortable
                    initialSort={{ key: 'sugerido', dir: 'desc' }}
                    rowClassName={(r) => {
                        const urg = r.shipping_urgency;
                        if (urg === 'URGENT' || urg === 'THIS_WEEK') return 'bg-[var(--err)]/10';
                        if (urg === 'NEXT_WEEK' || urg === 'IN_TWO_WEEKS') return 'bg-[var(--warn)]/10';
                        if (r.cobertura_dias != null && r.cobertura_dias < (data?.cobertura_deseada ?? 30) && r.ventas_ultimo_mes > 0) return 'bg-[var(--warn)]/10';
                        return undefined;
                    }}
                />
            </Card>

            {/* Envíos planificados (decisión del operario) */}
            <Card title="Envíos planificados">
                {planes.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-[var(--text-faint)]">Sin envíos planificados. Usa «Planificar envío» para decidir qué y cuánto enviar.</p>
                ) : (
                    <div className="divide-y divide-[var(--border)]">
                        {planes.map((p: any) => (
                            <div key={p.id} className="px-4 py-2.5 flex flex-wrap items-center gap-3">
                                <Badge tone={p.estado === 'confirmado' ? 'info' : p.estado === 'cerrado' ? 'success' : 'neutral'}>{p.estado}</Badge>
                                <span className="text-sm text-[var(--text)] font-mono">{p.guia || '(sin guía)'}</span>
                                <span className="text-xs text-[var(--text-faint)]">{p.fecha_creacion ? new Date(p.fecha_creacion).toLocaleDateString('es-MX') : ''}</span>
                                <div className="flex-1" />
                                <Btn size="sm" variant="outline" onClick={() => abrirPlan(p.id)}>Abrir</Btn>
                                {p.estado !== 'cerrado' && <Btn size="sm" variant="ghost" onClick={() => eliminarPlan(p.id)}>Descartar</Btn>}
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            {/* Workflow de envíos */}
            <Card title="Envíos Full (pendiente → reunido → preparado)">
                <DataTable<Envio>
                    columns={envioColumns}
                    rows={envios}
                    rowKey={(r) => r.guia}
                    empty="Sin envíos Full en los últimos 30 días"
                    sortable
                    initialSort={{ key: 'fecha', dir: 'desc' }}
                />
            </Card>

            {/* Detalle de envío (ajustar cantidad + verificar cambios) */}
            {detalle && (() => {
                const pendientes = detalle.egresos.filter((e: any) => e.edo_reunido == null).length;
                const reunidos = detalle.egresos.filter((e: any) => e.edo_reunido === 'Reunido').length;
                const preparados = detalle.egresos.filter((e: any) => e.edo_reunido === 'Preparado').length;
                const totalPiezas = detalle.egresos.reduce((s: number, e: any) => s + Number(e.cantidad || 0), 0);
                return (
                <Card title={`Envío ${detalle.guia}`}>
                    <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
                        <p className="text-sm text-[var(--text)]">
                            <span className="font-semibold">{detalle.egresos.length} productos</span>
                            {' · '}<span className="font-semibold">{totalPiezas} piezas en total</span>
                        </p>
                        <div className="flex flex-wrap gap-2 mt-1.5">
                            <Badge tone="neutral">{pendientes} pendientes</Badge>
                            <Badge tone="info">{reunidos} reunidos</Badge>
                            <Badge tone="success">{preparados} preparados</Badge>
                        </div>
                    </div>
                    {detalleLoading ? (
                        <div className="px-6 py-8 text-center text-[var(--text-faint)]">Cargando…</div>
                    ) : (
                        <div className="divide-y divide-[var(--border)]">
                            {detalle.egresos.map((e: any) => {
                                const estado = e.edo_reunido === 'Preparado' ? 'Preparado' : e.edo_reunido === 'Reunido' ? 'Reunido' : 'Pendiente';
                                return (
                                <div key={e.egreso_id || e.id} className="px-4 py-2.5 flex flex-wrap items-center gap-3">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm text-[var(--text)] truncate">{e.nombre || e.articulo_id}</p>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <Badge tone={estado === 'Preparado' ? 'success' : estado === 'Reunido' ? 'info' : 'neutral'}>{estado}</Badge>
                                            {e.notas && <span className="text-xs text-[var(--warn)] break-words">{e.notas}</span>}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-xs text-[var(--text-faint)]">cant.</span>
                                        <input
                                            type="number"
                                            min={0}
                                            defaultValue={e.cantidad}
                                            key={`${e.egreso_id || e.id}-${e.cantidad}`}
                                            onBlur={(ev) => {
                                                const v = Number(ev.target.value);
                                                if (Number.isFinite(v) && v >= 0 && v !== Number(e.cantidad)) ajustarCantidad(e.egreso_id || e.id, v);
                                            }}
                                            className="w-20 px-2 py-1 bg-[var(--surface)] border border-[var(--border)] rounded text-sm text-[var(--text)] font-mono"
                                        />
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {estado === 'Pendiente' && (
                                            <Btn size="sm" variant="outline" loading={avanzandoGuia === (e.egreso_id || e.id)} onClick={() => cambiarEstado(e.egreso_id || e.id, 'reunir')}>Reunir</Btn>
                                        )}
                                        {estado === 'Reunido' && (
                                            <Btn size="sm" variant="primary" loading={avanzandoGuia === (e.egreso_id || e.id)} onClick={() => cambiarEstado(e.egreso_id || e.id, 'preparar')}>Preparar</Btn>
                                        )}
                                        {(estado === 'Reunido' || estado === 'Preparado') && (
                                            <Btn size="sm" variant="ghost" loading={avanzandoGuia === (e.egreso_id || e.id)} onClick={() => cambiarEstado(e.egreso_id || e.id, 'quitar')}>Quitar</Btn>
                                        )}
                                    </div>
                                </div>
                                );
                            })}
                            <div className="px-4 py-2 flex justify-end">
                                <Btn size="sm" variant="ghost" onClick={() => setDetalle(null)}>Cerrar</Btn>
                            </div>
                        </div>
                    )}
                </Card>
                );
            })()}

            {/* Modal de envío planificado */}
            {planAbierto && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60" onClick={() => setPlanAbierto(null)}>
                    <div className="w-full max-w-2xl max-h-[85vh] overflow-auto bg-[var(--surface)] rounded-xl border border-[var(--border)] p-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-[var(--text)] flex items-center gap-2">
                                Envío planificado
                                <Badge tone={planAbierto.estado === 'confirmado' ? 'info' : planAbierto.estado === 'cerrado' ? 'success' : 'neutral'}>{planAbierto.estado}</Badge>
                            </h3>
                            <Btn size="sm" variant="ghost" onClick={() => setPlanAbierto(null)}>✕</Btn>
                        </div>

                        {planAbierto.items.length === 0 ? (
                            <p className="py-6 text-center text-sm text-[var(--text-faint)]">Sin productos. Agrega un código ML abajo.</p>
                        ) : (
                            <div className="divide-y divide-[var(--border)] mt-2">
                                {planAbierto.items.map((it: any, i: number) => (
                                    <div key={i} className="py-2 flex items-center gap-3">
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm text-[var(--text)] truncate">{it.nombre || it.inventory_id}</p>
                                            <p className="text-xs text-[var(--text-faint)] font-mono">{it.inventory_id}{it.objetivo != null ? ` · sugerido ${it.objetivo}` : ''}</p>
                                        </div>
                                        <input
                                            type="number" min={0} value={it.cantidad}
                                            onChange={(e) => ajustarItem(i, Number(e.target.value) || 0)}
                                            className="w-20 px-2 py-1 bg-[var(--surface)] border border-[var(--border)] rounded text-sm text-[var(--text)] font-mono text-right"
                                        />
                                        <Btn size="sm" variant="ghost" onClick={() => quitarItem(i)}>✕</Btn>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="flex flex-wrap gap-2 mt-3 items-center">
                            <input value={nuevoCodigo} onChange={(e) => setNuevoCodigo(e.target.value)} placeholder="Código ML" className="flex-1 min-w-40 px-2 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded text-sm text-[var(--text)] font-mono" />
                            <input type="number" min={0} value={nuevoCantidad} onChange={(e) => setNuevoCantidad(e.target.value)} placeholder="Cant." className="w-20 px-2 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded text-sm text-[var(--text)] font-mono" />
                            <Btn size="sm" variant="outline" onClick={agregarItem}>Agregar</Btn>
                        </div>

                        <div className="flex flex-wrap justify-end gap-2 mt-4">
                            <Btn size="sm" variant="ghost" onClick={() => setPlanAbierto(null)}>Cerrar</Btn>
                            <Btn size="sm" variant="outline" loading={planGuardando} onClick={() => guardarPlan()}>Guardar</Btn>
                            {planAbierto.estado === 'borrador' && (
                                <Btn size="sm" variant="primary" loading={planGuardando} onClick={() => guardarPlan('confirmar')}>Confirmar envío</Btn>
                            )}
                            {planAbierto.estado === 'confirmado' && (
                                <Btn size="sm" variant="primary" loading={planGuardando} onClick={() => guardarPlan('cerrar')}>Cerrar envío</Btn>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </Page>
    );
}
