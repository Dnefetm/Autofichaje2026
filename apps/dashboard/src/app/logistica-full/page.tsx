"use client";
import { useCallback, useEffect, useState } from 'react';
import { Page } from '@/components/ui/Page';
import { PageHeader } from '@/components/ui/PageHeader';
import { Btn } from '@/components/ui/Btn';
import { Card } from '@/components/ui/Card';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { RefreshCw, PackageSearch, Truck, Boxes } from 'lucide-react';

interface PropItem {
    articulo_id: string;
    nombre: string | null;
    es_full: boolean;
    disponibles: number | null;
    inventory_ids: string[];
    stock_full: number;
    ventas_60d: number;
    sugerido: number;
}

interface PropData {
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

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await fetch('/api/logistica-full/propuesta');
            const j = await r.json();
            if (j.success) setData(j);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, []);

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
        { key: 'stock_full', label: 'Stock Full', align: 'right', render: (r) => <span className="font-mono">{r.stock_full}</span> },
        {
            key: 'disponibles',
            label: 'Bodega',
            align: 'right',
            render: (r) => (
                <span className="font-mono" style={{ color: r.disponibles != null && r.disponibles < 0 ? 'var(--err)' : undefined }}>
                    {r.disponibles ?? '—'}
                </span>
            ),
        },
        { key: 'ventas_60d', label: `Ventas ${data?.dias_ventana ?? 60}d`, align: 'right', render: (r) => <span className="font-mono">{r.ventas_60d}</span> },
        {
            key: 'sugerido',
            label: 'Sugerido',
            align: 'right',
            render: (r) =>
                r.sugerido > 0 ? (
                    <Badge tone="warning"><Truck className="w-3 h-3" /> {r.sugerido}</Badge>
                ) : (
                    <span className="font-mono text-[var(--text-faint)]">—</span>
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
                    <Btn onClick={sync} loading={syncing} icon={<RefreshCw className="w-4 h-4" />}>
                        Sincronizar stock
                    </Btn>
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
