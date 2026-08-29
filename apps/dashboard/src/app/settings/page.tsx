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
            auth === 'success' ? "bg-[var(--ok)]/10 border-[var(--ok)]/30 text-emerald-800" : "bg-[var(--err)]/10 border-[var(--err)]/30 text-rose-800"
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
        <Suspense fallback={<div className="p-8 text-center text-[var(--text-faint)]">Cargando configuración...</div>}>
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
            const res = await fetch('/api/settings/meli');
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    setConfigs(data);
                    setDbState('online');
                    return;
                }
            }

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
        const needsAuth = configs.find((c: any) => !c.marketplace_tokens || c.marketplace_tokens.length === 0);
        if (needsAuth) {
            window.location.href = `/api/auth/meli?marketplace_id=${needsAuth.id}`;
        } else if (configs.length > 0) {
            window.location.href = `/api/auth/meli?marketplace_id=${configs[0].id}`;
        } else {
            alert('Primero crea una configuración de tienda en la base de datos.');
        }
    };

    return (
        <div className="max-w-4xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* -- Tiendas -- */}
            <div className="flex justify-between items-start md:items-end flex-col md:flex-row gap-4">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-[var(--text)]">Tiendas Conectadas</h2>
                    <p className="text-[var(--text-muted)] text-sm mt-1">
                        Vincula cuentas de Mercado Libre de tus vendedores.
                        El Gestor centralizará el inventario de todas ellas.
                    </p>
                </div>
                <button
                    onClick={handleLinkNewStore}
                    className="px-5 py-2.5 bg-yellow-400 text-[var(--text)] rounded-xl font-bold text-sm hover:bg-yellow-500 transition-colors shadow-sm flex items-center gap-2"
                >
                    <LinkIcon className="w-4 h-4" />
                    + Vincular Nueva Tienda MeLi
                </button>
            </div>

            <AuthFeedback />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-4">
                    {configs.length === 0 ? (
                        <div className="p-8 text-center bg-[var(--bg)] border border-[var(--border)] border-dashed rounded-xl">
                            <Database className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                            <h3 className="text-sm font-bold text-[var(--text-muted)]">No hay tiendas vinculadas</h3>
                            <p className="text-xs text-[var(--text-muted)] mt-1">Haz clic en el botón amarillo para autorizar la primera cuenta.</p>
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
                    <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-sm p-6 space-y-4 text-sm">
                        <h4 className="font-bold text-[var(--text)] flex items-center gap-2">
                            <Shield className="w-4 h-4 text-[var(--ok)]" />
                            Estado del Gestor
                        </h4>
                        <StatusItem label="Supabase DB" status={dbState === 'online' ? 'online' : (dbState === 'error' ? 'offline' : 'checking')} />
                        <StatusItem label="Oauth Central" status="online" />
                        <StatusItem label="Catálogo Maestro" status="online" />
                        
                        <div className="pt-2 border-t border-[var(--border)]">
                            <a href="/settings/pricing" className="text-[var(--accent)] hover:text-indigo-800 font-bold flex items-center justify-between group">
                                Estrategia de Precios 
                                <ChevronRight className="w-4 h-4 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                            </a>
                        </div>
                    </div>
                </div>
            </div>

            {/* -- Panel de control de Webhooks -- */}
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
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-sm overflow-hidden flex items-center justify-between p-5 hover:border-slate-300 transition-colors">
            <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-yellow-400 rounded-xl flex items-center justify-center font-bold text-yellow-900 text-lg shadow-inner">
                    {config.account_name.substring(0, 2).toUpperCase()}
                </div>
                <div>
                    <h3 className="font-bold text-[var(--text)] text-lg">{config.account_name}</h3>
                    <div className="text-xs text-[var(--text-muted)] flex items-center gap-1 mt-0.5">
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
            <span className="text-[var(--text-muted)] font-medium">{label}</span>
            <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px]">
                {status === 'online' && <><span className="w-1.5 h-1.5 bg-[var(--ok)]/100 rounded-full shadow-[0_0_5px_rgba(16,185,129,0.5)]" /> <span className="text-[var(--ok)]">En línea</span></>}
                {status === 'offline' && <><span className="w-1.5 h-1.5 bg-[var(--err)]/100 rounded-full shadow-[0_0_5px_rgba(244,63,94,0.5)]" /> <span className="text-[var(--err)]">Offline</span></>}
                {status === 'checking' && <><span className="w-1.5 h-1.5 bg-slate-400 animate-pulse rounded-full" /> <span className="text-[var(--text-muted)]">Validando</span></>}
            </div>
        </div>
    );
}

// --- Webhook Control Panel ----------------------------------------------------

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

    const DEFAULT_TOPICS: WebhookConfigRow[] = [
        { topic: 'orders_v2', label: 'Órdenes y pagos',              window_seconds: 0,   dispatch_immediate: true,  enabled: true, updated_at: '' },
        { topic: 'items',     label: 'Publicaciones (precio, stock)', window_seconds: 180, dispatch_immediate: false, enabled: true, updated_at: '' },
        { topic: 'questions', label: 'Preguntas y mensajes',          window_seconds: 300, dispatch_immediate: false, enabled: true, updated_at: '' },
        { topic: 'payments',  label: 'Pagos',                         window_seconds: 0,   dispatch_immediate: true,  enabled: true, updated_at: '' },
    ];
    const allTopics = DEFAULT_TOPICS.map(def => configs.find(c => c.topic === def.topic) ?? def);

    return (
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-sm overflow-hidden">
            {/* Header colapsable */}
            <button
                onClick={() => setExpanded(e => !e)}
                className="w-full flex items-center justify-between p-6 hover:bg-[var(--bg)] transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-[var(--accent)]/20 rounded-xl flex items-center justify-center">
                        <Zap className="w-4 h-4 text-[var(--accent)]" />
                    </div>
                    <div className="text-left">
                        <h3 className="font-bold text-[var(--text)] text-base">Webhooks — Velocidad de reacción</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            Controla qué tan rápido procesa cada tipo de notificación de MeLi
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    {!loading && (
                        <div className="hidden md:flex items-center gap-4 text-xs text-[var(--text-muted)]">
                            <span className="flex items-center gap-1">
                                <Activity className="w-3.5 h-3.5 text-[var(--accent)]" />
                                {totalEventos} eventos (24h)
                            </span>
                            <span className="flex items-center gap-1 text-[var(--ok)] font-semibold">
                                {totalJobsEvitados} jobs evitados
                            </span>
                            {totalPending > 0 && (
                                <span className="flex items-center gap-1 text-[var(--warn)] font-semibold">
                                    {totalPending} en cola
                                </span>
                            )}
                        </div>
                    )}
                    {expanded ? <ChevronDown className="w-4 h-4 text-[var(--text-faint)]" /> : <ChevronRight className="w-4 h-4 text-[var(--text-faint)]" />}
                </div>
            </button>

            {expanded && (
                <div className="border-t border-[var(--border)]">
                    {loading ? (
                        <div className="p-8 text-center text-[var(--text-faint)] text-sm">Cargando configuración...</div>
                    ) : (
                        <>
                            <div className="divide-y divide-[var(--border)]">
                                {allTopics.map(def => {
                                    const topic = def.topic;
                                    const enabled = getVal(topic, 'enabled', def.enabled);
                                    const windowSecs = getVal(topic, 'window_seconds', def.window_seconds);
                                    const isImmediate = getVal(topic, 'dispatch_immediate', def.dispatch_immediate);
                                    const isDirty = !!pendingChanges[topic];
                                    const metric = metrics.find(m => m.topic === topic);

                                    return (
                                        <div key={topic} className={cn("px-6 py-5 flex flex-col gap-3", !enabled && "opacity-40")}>

                                            {/* Fila 1: habilitar + nombre + métricas */}
                                            <div className="flex items-center justify-between gap-4">
                                                <div className="flex items-center gap-3">
                                                    <button
                                                        id={`toggle-${topic}`}
                                                        onClick={() => handleChange(topic, 'enabled', !enabled)}
                                                        title={enabled ? 'Deshabilitar' : 'Habilitar'}
                                                        className="shrink-0"
                                                    >
                                                        {enabled
                                                            ? <ToggleRight className="w-6 h-6 text-emerald-500" />
                                                            : <ToggleLeft className="w-6 h-6 text-slate-300" />}
                                                    </button>
                                                    <div>
                                                        <p className="font-semibold text-sm text-[var(--text)]">{def.label}</p>
                                                        <p className="text-[10px] text-[var(--text-faint)] font-mono mt-0.5">{topic}</p>
                                                    </div>
                                                </div>
                                                {metric && (
                                                    <div className="flex items-center gap-3 text-xs text-[var(--text-faint)] shrink-0">
                                                        <span>{metric.total_events} recibidos</span>
                                                        <span className="text-[var(--ok)] font-semibold">{metric.jobs_evitados} jobs evitados</span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Fila 2: selector de modo + control de ventana */}
                                            <div className="flex flex-col sm:flex-row sm:items-center gap-3 pl-9">

                                                {/* Segmented control — dos opciones claras y clicables */}
                                                <div className="flex rounded-lg border border-[var(--border)] overflow-hidden shrink-0 text-xs font-semibold">
                                                    <button
                                                        id={`mode-immediate-${topic}`}
                                                        onClick={() => handleChange(topic, 'dispatch_immediate', true)}
                                                        disabled={!enabled}
                                                        title="Procesar en cuanto llega la notificación"
                                                        className={cn(
                                                            "flex items-center gap-1.5 px-3 py-2 transition-colors",
                                                            isImmediate
                                                                ? "bg-[var(--ok)]/100 text-[var(--accent-ink)]"
                                                                : "bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--bg)]"
                                                        )}
                                                    >
                                                        <Zap className="w-3.5 h-3.5" /> Inmediato
                                                    </button>
                                                    <button
                                                        id={`mode-window-${topic}`}
                                                        onClick={() => handleChange(topic, 'dispatch_immediate', false)}
                                                        disabled={!enabled}
                                                        title="Acumular notificaciones y crear un solo job por producto"
                                                        className={cn(
                                                            "flex items-center gap-1.5 px-3 py-2 border-l border-[var(--border)] transition-colors",
                                                            !isImmediate
                                                                ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                                                                : "bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--bg)]"
                                                        )}
                                                    >
                                                        <Clock className="w-3.5 h-3.5" /> Con ventana
                                                    </button>
                                                </div>

                                                {/* Descripción y control según modo seleccionado */}
                                                {isImmediate ? (
                                                    <p className="text-xs text-[var(--text-muted)] italic">
                                                        Se procesa en cuanto llega la notificación — mayor gasto de Edge Requests.
                                                    </p>
                                                ) : (
                                                    <div className="flex items-center gap-3 flex-1">
                                                        <input
                                                            id={`window-${topic}`}
                                                            type="range"
                                                            min={1}
                                                            max={30}
                                                            step={1}
                                                            value={Math.max(1, Math.round(windowSecs / 60))}
                                                            onChange={e => handleChange(topic, 'window_seconds', Number(e.target.value) * 60)}
                                                            className="flex-1 accent-indigo-600"
                                                            disabled={!enabled}
                                                        />
                                                        <span className="text-sm font-bold text-[var(--text-muted)] w-44 shrink-0 tabular-nums">
                                                            {`Consolidar ${Math.max(1, Math.round(windowSecs / 60))} min`}
                                                        </span>
                                                    </div>
                                                )}

                                                {isDirty && (
                                                    <button
                                                        id={`save-${topic}`}
                                                        onClick={() => saveTopic(topic)}
                                                        disabled={saving === topic}
                                                        className="flex items-center gap-1.5 px-3 py-2 bg-[var(--accent)] hover:brightness-110 text-[var(--accent-ink)] text-xs font-bold rounded-lg transition-colors disabled:opacity-50 shrink-0"
                                                    >
                                                        {saving === topic ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                                        Guardar
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Footer con explicación en lenguaje de negocio */}
                            <div className="px-6 py-4 bg-[var(--bg)] border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-4 text-xs text-[var(--text-muted)]">
                                <div className="flex flex-wrap gap-x-6 gap-y-2">
                                    <span className="flex items-center gap-1.5">
                                        <Zap className="w-3.5 h-3.5 text-emerald-500" />
                                        <strong>Inmediato:</strong> el worker se activa al instante — ideal para órdenes y pagos.
                                    </span>
                                    <span className="flex items-center gap-1.5">
                                        <Clock className="w-3.5 h-3.5 text-[var(--accent)]" />
                                        <strong>Con ventana:</strong> si el mismo producto se modifica 20 veces en 3 min, se crea 1 solo job en lugar de 20. Reduce costos.
                                    </span>
                                </div>
                                <button onClick={loadData} className="flex items-center gap-1 text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors shrink-0">
                                    <RefreshCw className="w-3 h-3" /> Actualizar
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}


function ProveedorConfigPanel() {
    const [configs, setConfigs] = useState<any[]>([]);
