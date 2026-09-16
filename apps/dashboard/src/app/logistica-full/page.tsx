"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
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
    inventory_id: string;
    nombre: string | null;
    articulo_id: string;
    ventas_ultimo_mes: number;
    stock_full: number;
    pendientes: number;
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
    const [importando, setImportando] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

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
                toast.success(`PDF ${j.guia} importado: ${j.salidas_generadas} salidas (${j.nuevas} nuevas)`);
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

    const columns: Column<PropItem>[] = [
        {
            key: 'nombre',
            label: 'Producto',
            render: (r) => (
                <div className="min-w-0">
                    <p className="font-medium text-[var(--text)] truncate">{r.nombre || '(sin nombre)'}</p>
                    <p className="text-xs text-[var(--text-faint)] font-mono">{r.inventory_id}</p>
                </div>
            ),
        },
        { key: 'ventas_ultimo_mes', label: 'Ventas mes', align: 'right', render: (r) => <span className="font-mono">{r.ventas_ultimo_mes}</span> },
        { key: 'stock_full', label: 'Full (aptas)', align: 'right', render: (r) => <span className="font-mono">{r.stock_full}</span> },
        {
            key: 'pendientes',
            label: 'Pendientes',
            align: 'right',
            render: (r) => (r.pendientes > 0 ? <span className="font-mono text-[var(--info)]">+{r.pendientes}</span> : <span className="font-mono text-[var(--text-faint)]">0</span>),
        },
        { key: 'stock_efectivo', label: 'Efectivo', align: 'right', render: (r) => <span className="font-mono font-semibold">{r.stock_efectivo}</span> },
        {
            key: 'cobertura_dias',
            label: 'Cobertura',
            align: 'right',
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
            </div>

            {/* Propuesta */}
            <Card title="Propuesta de reposición">
                <DataTable<PropItem>
                    columns={columns}
                    rows={data?.propuesta || []}
                    rowKey={(r) => r.articulo_id}
                    loading={loading}
                    empty="Sin artículos Full mapeados"
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
        </Page>
    );
}
