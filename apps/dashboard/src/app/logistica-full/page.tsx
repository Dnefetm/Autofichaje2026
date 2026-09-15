"use client";
import { useCallback, useEffect, useState } from 'react';
import { Page } from '@/components/ui/Page';
import { PageHeader } from '@/components/ui/PageHeader';
import { Btn } from '@/components/ui/Btn';
import { Card } from '@/components/ui/Card';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { RefreshCw, PackageSearch, Truck, Boxes, Download } from 'lucide-react';

interface PropItem {
    articulo_id: string;
    nombre: string | null;
    es_full: boolean;
    disponibles: number | null;
    inventory_ids: string[];
    stock_efectivo: number;
    ventas_30d: number;
    demanda: number;
    cobertura_actual: number | null;
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

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await fetch(`/api/logistica-full/propuesta?cobertura=${cobertura}&metodo=${metodo}`);
            const j = await r.json();
            if (j.success) setData(j);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [cobertura, metodo]);

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
        const head = ['articulo', 'stock_efectivo', 'ventas_30d', 'demanda', 'cobertura_dias', 'a_enviar', 'sugerencia_ml', 'urgencia'];
        const rows = data.propuesta.map((p) => [
            `"${(p.nombre || '').replace(/"/g, '""')}"`,
            p.stock_efectivo,
            p.ventas_30d,
            p.demanda,
            p.cobertura_actual ?? '',
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

    const avanzar = async (guia: string, accion: 'reunir' | 'preparar') => {
        setAvanzandoGuia(guia);
        try {
            const r = await fetch('/api/logistica-full/envio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ guia, accion }),
            });
            const j = await r.json();
            await loadEnvios();
        } catch (e) {
            console.error(e);
        } finally {
            setAvanzandoGuia(null);
        }
    };

    const columns: Column<PropItem>[] = [
        {
            key: 'nombre',
            label: 'Artículo',
            render: (r) => (
                <div className="min-w-0">
                    <p className="font-medium text-[var(--text)] truncate">{r.nombre || '(sin nombre)'}</p>
                    <p className="text-xs text-[var(--text-faint)]">{r.inventory_ids.length} pack(s) Full</p>
                </div>
            ),
        },
        { key: 'stock_efectivo', label: 'Stock efectivo', align: 'right', render: (r) => <span className="font-mono">{r.stock_efectivo}</span> },
        { key: 'ventas_30d', label: 'Ventas 30d', align: 'right', render: (r) => <span className="font-mono">{r.ventas_30d}</span> },
        { key: 'demanda', label: 'Demanda', align: 'right', render: (r) => <span className="font-mono">{r.demanda}</span> },
        {
            key: 'cobertura_actual',
            label: 'Cobertura',
            align: 'right',
            render: (r) => {
                const bajo = r.cobertura_actual != null && r.cobertura_actual < (data?.cobertura_deseada ?? 30);
                return r.cobertura_actual != null ? (
                    <span className="font-mono" style={{ color: bajo ? 'var(--err)' : 'var(--ok)' }}>{r.cobertura_actual}d</span>
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
        { key: 'count', label: 'Ítems', align: 'right', render: (r) => <span className="font-mono">{r.count}</span> },
        { key: 'cantidad', label: 'Unidades', align: 'right', render: (r) => <span className="font-mono">{r.cantidad}</span> },
        { key: 'fecha', label: 'Fecha', render: (r) => (r.fecha ? new Date(r.fecha).toLocaleDateString('es-MX') : '—') },
        {
            key: 'acciones',
            label: '',
            render: (r) => (
                <div className="flex gap-1.5 justify-end">
                    {r.estado === 'Pendiente' && (
                        <Btn size="sm" variant="outline" loading={avanzandoGuia === r.guia} onClick={() => avanzar(r.guia, 'reunir')}>
                            Reunir
                        </Btn>
                    )}
                    {(r.estado === 'Pendiente' || r.estado === 'Reunido') && (
                        <Btn size="sm" variant="primary" loading={avanzandoGuia === r.guia} onClick={() => avanzar(r.guia, 'preparar')}>
                            Preparar
                        </Btn>
                    )}
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
                        <Btn onClick={sync} loading={syncing} icon={<RefreshCw className="w-4 h-4" />}>
                            Sincronizar stock
                        </Btn>
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
                />
            </Card>

            {/* Workflow de envíos */}
            <Card title="Envíos Full (pendiente → reunido → preparado)">
                <DataTable<Envio>
                    columns={envioColumns}
                    rows={envios}
                    rowKey={(r) => r.guia}
                    empty="Sin envíos Full en los últimos 30 días"
                />
            </Card>
        </Page>
    );
}
