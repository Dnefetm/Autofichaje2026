"use client";
// Force fast refresh 1

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
    Settings,
    Link as LinkIcon,
    Shield,
    Database,
    CheckCircle2,
    AlertCircle,
    Save,
    RefreshCw,
    Zap,
    Clock,
    Activity,
    ToggleLeft,
    ToggleRight,
    ChevronDown,
    ChevronRight
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

function AuthFeedback() {
    const searchParams = useSearchParams();
    const auth = searchParams.get('auth');

    if (!auth) return null;

    return (
        <div className={cn(
            "p-4 rounded-xl border mb-6 flex items-center gap-3 animate-in zoom-in-95 duration-300",
            auth === 'success' ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"
        )}>
            {auth === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            <span className="text-sm font-bold">
                {auth === 'success' ? '¡Tu cuenta de Mercado Libre ha sido vinculada con éxito!' : 'Hubo un error al vincular tu cuenta. Por favor verifica tus credenciales.'}
            </span>
        </div>
    );
}

export default function SettingsPage() {
    return (
        <Suspense fallback={<div className="p-8 text-center text-slate-400">Cargando configuración...</div>}>
            <SettingsContent />
        </Suspense>
    );
}

function SettingsContent() {
    const [configs, setConfigs] = useState<any[]>([]);
    const [dbState, setDbState] = useState<'checking' | 'online' | 'error'>('checking');

    useEffect(() => {
        loadConfigs();
    }, []);

    async function loadConfigs() {
        try {
            // Intentar via API route (usa service key)
            const res = await fetch('/api/settings/meli');
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    setConfigs(data);
                    setDbState('online');
                    return;
                }
            }

            // Fallback: query directa a Supabase (por si el filtro de marketplace no coincide)
            const { data: directData, error } = await supabase
                .from('marketplace_configs')
                .select('*, marketplace_tokens(access_token, updated_at, expires_at)')
                .eq('is_active', true)
                .order('created_at', { ascending: true });

            if (error) throw error;
            setConfigs(directData || []);
            setDbState('online');
        } catch (err) {
            console.error('Load config error:', err);
            setDbState('error');
        }
    }

    const handleLinkNewStore = () => {
        // Buscar cuenta que necesite autorización (sin tokens)
        const needsAuth = configs.find((c: any) => !c.marketplace_tokens || c.marketplace_tokens.length === 0);
        if (needsAuth) {
            window.location.href = `/api/auth/meli?marketplace_id=${needsAuth.id}`;
        } else if (configs.length > 0) {
            // Todas tienen tokens, re-vincular la primera (para refrescar)
            window.location.href = `/api/auth/meli?marketplace_id=${configs[0].id}`;
        } else {
            alert('Primero crea una configuración de tienda en la base de datos.');
        }
    };

    return (
        <div className="max-w-4xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* ── Tiendas ── */}
            <div className="flex justify-between items-start md:items-end flex-col md:flex-row gap-4">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900">Tiendas Conectadas</h2>
                    <p className="text-slate-500 text-sm mt-1">
                        Vincula cuentas de Mercado Libre de tus vendedores.
                        El Gestor centralizará el inventario de todas ellas.
                    </p>
                </div>
                <button
                    onClick={handleLinkNewStore}
                    className="px-5 py-2.5 bg-yellow-400 text-slate-900 rounded-xl font-bold text-sm hover:bg-yellow-500 transition-colors shadow-sm flex items-center gap-2"
                >
                    <LinkIcon className="w-4 h-4" />
                    + Vincular Nueva Tienda MeLi
                </button>
            </div>

            <AuthFeedback />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-4">
                    {configs.length === 0 ? (
                        <div className="p-8 text-center bg-slate-50 border border-slate-200 border-dashed rounded-xl">
                            <Database className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                            <h3 className="text-sm font-bold text-slate-700">No hay tiendas vinculadas</h3>
                            <p className="text-xs text-slate-500 mt-1">Haz clic en el botón amarillo para autorizar la primera cuenta.</p>
                        </div>
                    ) : (
                        configs.map((config, idx) => (
                            <StoreCard
                                key={config.id || idx}
                                config={config}
                            />
                        ))
                    )}
                </div>

                <div className="space-y-4">
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4 text-sm">
                        <h4 className="font-bold text-slate-900 flex items-center gap-2">
                            <Shield className="w-4 h-4 text-emerald-600" />
                            Estado del Gestor
                        </h4>
                        <StatusItem label="Supabase DB" status={dbState === 'online' ? 'online' : (dbState === 'error' ? 'offline' : 'checking')} />
                        <StatusItem label="Oauth Central" status="online" />
                        <StatusItem label="Catálogo Maestro" status="online" />
                    </div>
                </div>
            </div>

            {/* ── Panel de control de Webhooks ── */}
            <WebhookControlPanel />
        </div>
    );
}

function StoreCard({ config }: { config: any }) {
    const hasToken = config.marketplace_tokens && config.marketplace_tokens.length > 0;

    const handleReauth = () => {
        window.location.href = `/api/auth/meli?marketplace_id=${config.id}`;
    };

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex items-center justify-between p-5 hover:border-slate-300 transition-colors">
            <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-yellow-400 rounded-xl flex items-center justify-center font-bold text-yellow-900 text-lg shadow-inner">
                    {config.account_name.substring(0, 2).toUpperCase()}
                </div>
                <div>
                    <h3 className="font-bold text-slate-900 text-lg">{config.account_name}</h3>
                    <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                        <span className="text-yellow-600 font-semibold">Mercado Libre</span>
                        <span>•</span>
                        <span>ID: {config.settings?.seller_id || config.id.split('-')[0]}</span>
                    </div>
                </div>
            </div>

            <div className="flex flex-col items-end gap-2">
                {hasToken ? (
                    <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 rounded-full flex items-center gap-1.5 shadow-sm">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Vinculada
                    </span>
                ) : (
                    <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider bg-amber-100 text-amber-800 rounded-full flex items-center gap-1.5 shadow-sm">
                        <AlertCircle className="w-3.5 h-3.5" /> Faltan Permisos
                    </span>
                )}
                <button
                    onClick={handleReauth}
                    className="px-3 py-1 text-sm bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg border border-amber-300 transition-colors"
                >
                    {hasToken ? 'Re-autorizar' : 'Vincular Cuenta'}
                </button>
            </div>
        </div>
    );
}

function StatusItem({ label, status }: { label: string, status: 'online' | 'offline' | 'checking' }) {
    return (
        <div className="flex justify-between items-center text-xs">
            <span className="text-slate-600 font-medium">{label}</span>
            <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px]">
                {status === 'online' && <><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full shadow-[0_0_5px_rgba(16,185,129,0.5)]" /> <span className="text-emerald-700">En línea</span></>}
                {status === 'offline' && <><span className="w-1.5 h-1.5 bg-rose-500 rounded-full shadow-[0_0_5px_rgba(244,63,94,0.5)]" /> <span className="text-rose-700">Offline</span></>}
                {status === 'checking' && <><span className="w-1.5 h-1.5 bg-slate-400 animate-pulse rounded-full" /> <span className="text-slate-500">Validando</span></>}
            </div>
        </div>
    );
}

// ─── Webhook Control Panel ────────────────────────────────────────────────────

type WebhookConfigRow = {
    topic: string;
    label: string;
    window_seconds: number;
    dispatch_immediate: boolean;
    enabled: boolean;
    updated_at: string;
};

type TopicMetric = {
    topic: string;
    total_events: number;
    pending: number;
    done: number;
    jobs_evitados: number;
    last_seen_at: string | null;
};

function WebhookControlPanel() {
    const [configs, setConfigs] = useState<WebhookConfigRow[]>([]);
    const [metrics, setMetrics] = useState<TopicMetric[]>([]);
    const [jobsEnCola, setJobsEnCola] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(true);
    const [pendingChanges, setPendingChanges] = useState<Record<string, Partial<WebhookConfigRow>>>({});

    useEffect(() => { loadData(); }, []);

    async function loadData() {
        setLoading(true);
        try {
            const res = await fetch('/api/settings/webhook');
            if (!res.ok) throw new Error('Error cargando configuración de webhook');
            const data = await res.json();
            setConfigs(data.configs || []);
            setMetrics(data.metrics || []);
            setJobsEnCola(data.jobs_en_cola || {});
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }

    function handleChange(topic: string, key: keyof WebhookConfigRow, value: any) {
        setPendingChanges(prev => ({
            ...prev,
            [topic]: { ...(prev[topic] ?? {}), [key]: value }
        }));
    }

    function getVal<K extends keyof WebhookConfigRow>(topic: string, key: K, fallback: WebhookConfigRow[K]): WebhookConfigRow[K] {
        const pending = pendingChanges[topic];
        if (pending && key in pending) return pending[key] as WebhookConfigRow[K];
        const cfg = configs.find(c => c.topic === topic);
        return cfg ? cfg[key] : fallback;
    }

    async function saveTopic(topic: string) {
        const changes = pendingChanges[topic];
        if (!changes) return;
        setSaving(topic);
        try {
            const res = await fetch('/api/settings/webhook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic, ...changes }),
            });
            if (!res.ok) throw new Error('Error guardando');
            await loadData();
            setPendingChanges(prev => { const n = { ...prev }; delete n[topic]; return n; });
        } catch (err) {
            console.error(err);
            alert('Error al guardar la configuración.');
        } finally {
            setSaving(null);
        }
    }

    const totalJobsEvitados = metrics.reduce((acc, m) => acc + (m.jobs_evitados ?? 0), 0);
    const totalEventos = metrics.reduce((acc, m) => acc + (m.total_events ?? 0), 0);
    const totalPending = Object.values(jobsEnCola).reduce((a, b) => a + b, 0);

    // Topics que ya tienen config en BD; completar con defaults para los que no
    const DEFAULT_TOPICS: WebhookConfigRow[] = [
        { topic: 'orders_v2', label: 'Órdenes y pagos',               window_seconds: 0,   dispatch_immediate: true,  enabled: true, updated_at: '' },
        { topic: 'items',     label: 'Publicaciones (precio, stock)',  window_seconds: 180, dispatch_immediate: false, enabled: true, updated_at: '' },
        { topic: 'questions', label: 'Preguntas y mensajes',           window_seconds: 300, dispatch_immediate: false, enabled: true, updated_at: '' },
        { topic: 'payments',  label: 'Pagos',                          window_seconds: 0,   dispatch_immediate: true,  enabled: true, updated_at: '' },
    ];
    const allTopics = DEFAULT_TOPICS.map(def => configs.find(c => c.topic === def.topic) ?? def);

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Header */}
            <button
                onClick={() => setExpanded(e => !e)}
                className="w-full flex items-center justify-between p-6 hover:bg-slate-50 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-indigo-100 rounded-xl flex items-center justify-center">
                        <Zap className="w-4 h-4 text-indigo-600" />
                    </div>
                    <div className="text-left">
                        <h3 className="font-bold text-slate-900 text-base">Webhooks — Velocidad de reacción</h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Controla qué tan rápido procesa cada tipo de notificación de MeLi
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    {/* Métricas resumen */}
                    {!loading && (
                        <div className="hidden md:flex items-center gap-4 text-xs text-slate-500">
                            <span className="flex items-center gap-1">
                                <Activity className="w-3.5 h-3.5 text-indigo-500" />
                                {totalEventos} eventos (24h)
                            </span>
                            <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                                {totalJobsEvitados} jobs evitados
                            </span>
                            {totalPending > 0 && (
                                <span className="flex items-center gap-1 text-amber-600 font-semibold">
                                    {totalPending} en cola
                                </span>
                            )}
                        </div>
                    )}
                    {expanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                </div>
            </button>

            {expanded && (
                <div className="border-t border-slate-100">
                    {loading ? (
                        <div className="p-8 text-center text-slate-400 text-sm">Cargando configuración...</div>
                    ) : (
                        <>
                            {/* Tabla de topics */}
                            <div className="divide-y divide-slate-100">
                                {allTopics.map(def => {
                                    const topic = def.topic;
                                    const enabled = getVal(topic, 'enabled', def.enabled);
                                    const windowSecs = getVal(topic, 'window_seconds', def.window_seconds);
                                    const isImmediate = getVal(topic, 'dispatch_immediate', def.dispatch_immediate);
                                    const isDirty = !!pendingChanges[topic];
                                    const metric = metrics.find(m => m.topic === topic);
                                    const jobsCount = (jobsEnCola['sync_item'] ?? 0) + (jobsEnCola['process_sale'] ?? 0);

                                    return (
                                        <div key={topic} className={cn(
                                            "p-5 flex flex-col md:flex-row md:items-center gap-4",
                                            !enabled && "opacity-50"
                                        )}>
                                            {/* Nombre + toggle enable */}
                                            <div className="flex items-center gap-3 min-w-[220px]">
                                                <button
                                                    onClick={() => handleChange(topic, 'enabled', !enabled)}
                                                    title={enabled ? 'Deshabilitar topic' : 'Habilitar topic'}
                                                    className="text-slate-400 hover:text-indigo-600 transition-colors"
                                                    id={`toggle-${topic}`}
                                                >
                                                    {enabled
                                                        ? <ToggleRight className="w-6 h-6 text-emerald-500" />
                                                        : <ToggleLeft className="w-6 h-6 text-slate-300" />}
                                                </button>
                                                <div>
                                                    <p className="font-semibold text-sm text-slate-800">{def.label}</p>
                                                    <p className="text-[10px] text-slate-400 font-mono">{topic}</p>
                                                </div>
                                            </div>

                                            {/* Toggle dispatch_immediate — editable para TODOS los topics */}
                                            <div className="min-w-[160px]">
                                                <button
                                                    id={`dispatch-${topic}`}
                                                    onClick={() => handleChange(topic, 'dispatch_immediate', !isImmediate)}
                                                    disabled={!enabled}
                                                    title={isImmediate ? 'Clic para cambiar a ventana' : 'Clic para activar despacho inmediato'}
                                                    className={cn(
                                                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer border",
                                                        isImmediate
                                                            ? "bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200"
                                                            : "bg-indigo-100 text-indigo-700 border-indigo-200 hover:bg-indigo-200"
                                                    )}
                                                >
                                                    {isImmediate
                                                        ? <><Zap className="w-3 h-3" /> Inmediato</>
                                                        : <><Clock className="w-3 h-3" /> Con ventana</>}
                                                </button>
                                            </div>

                                            {/* Slider de ventana — visible para TODOS los topics */}
                                            <div className="flex items-center gap-3 flex-1">
                                                    <div className="flex items-center gap-3 w-full">
                                                <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                                <input
                                                    id={`window-${topic}`}
                                                    type="range"
                                                    min={0}
                                                    max={300}
                                                    step={30}
                                                    value={windowSecs}
                                                    onChange={e => handleChange(topic, 'window_seconds', Number(e.target.value))}
                                                    className="flex-1 accent-indigo-600"
                                                    disabled={!enabled}
                                                />
                                                <span className="text-sm font-bold text-slate-700 w-20 text-right tabular-nums">
                                                    {windowSecs === 0 ? 'inmediato' : windowSecs >= 60 ? `${windowSecs / 60} min` : `${windowSecs}s`}
                                                </span>
                                            </div>

                                            {/* Métricas 24h */}
                                            {metric && (
                                                <div className="flex items-center gap-4 text-xs text-slate-500 shrink-0">
                                                    <span title="Eventos recibidos en 24h">{metric.total_events} eventos</span>
                                                    <span className="text-emerald-600 font-semibold" title="Jobs no creados por consolidación">
                                                        {metric.jobs_evitados} evitados
                                                    </span>
                                                </div>
                                            )}

                                            {/* Guardar */}
                                            {isDirty && (
                                                <button
                                                    onClick={() => saveTopic(topic)}
                                                    disabled={saving === topic}
                                                    id={`save-${topic}`}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50 shrink-0"
                                                >
                                                    {saving === topic ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                                    Guardar
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Footer con leyenda */}
                            <div className="px-5 py-4 bg-slate-50 border-t border-slate-100 flex flex-wrap gap-4 text-xs text-slate-500">
                                <span className="flex items-center gap-1"><Zap className="w-3.5 h-3.5 text-emerald-500" /> <strong>Inmediato:</strong> el worker se activa al recibir la notificación.</span>
                                <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-indigo-500" /> <strong>Con ventana:</strong> múltiples notificaciones del mismo item se consolidan. El cron las procesa en ≤1 min.</span>
                                <button onClick={loadData} className="ml-auto flex items-center gap-1 text-slate-400 hover:text-slate-700 transition-colors">
                                    <RefreshCw className="w-3 h-3" /> Actualizar métricas
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
