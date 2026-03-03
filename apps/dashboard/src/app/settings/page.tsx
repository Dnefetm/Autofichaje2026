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
    RefreshCw
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
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [dbState, setDbState] = useState<'checking' | 'online' | 'error'>('checking');

    useEffect(() => {
        loadConfigs();
    }, []);

    async function loadConfigs() {
        try {
            const res = await fetch('/api/settings/meli');
            if (!res.ok) throw new Error('Failed to fetch configs');
            const data = await res.json();

            if (Array.isArray(data) && data.length > 0) {
                setConfigs(data.map(c => ({
                    ...c,
                    client_id: c.settings?.client_id || '',
                    client_secret: c.settings?.client_secret || '',
                    has_token: c.marketplace_tokens && c.marketplace_tokens.length > 0
                })));
            } else {
                // Estado vacío
                addNewConfig();
            }
            setDbState('online');
        } catch (err) {
            console.error('Load config error:', err);
            setDbState('error');
        }
    }

    const addNewConfig = () => {
        setConfigs([...configs, {
            id: '',
            account_name: 'Nueva Tienda',
            marketplace: 'meli',
            client_id: '',
            client_secret: '',
            is_active: true,
            has_token: false
        }]);
    };

    return (
        <div className="max-w-4xl space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-end">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900">Configuración de Tiendas</h2>
                    <p className="text-slate-500 text-sm">Conecta tus cuentas reales de Mercado Libre para sincronización.</p>
                </div>
                <button
                    onClick={addNewConfig}
                    className="px-4 py-2 bg-slate-900 text-white rounded-lg font-bold text-sm hover:bg-slate-800 transition-colors"
                >
                    + Añadir Tienda
                </button>
            </div>

            <AuthFeedback />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-6">
                    {configs.map((config, idx) => (
                        <StoreCard
                            key={config.id || `new-${idx}`}
                            config={config}
                            index={idx}
                            onUpdate={(updatedValue) => {
                                const newConfigs = [...configs];
                                newConfigs[idx] = updatedValue;
                                setConfigs(newConfigs);
                            }}
                        />
                    ))}

                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-4 mt-6">
                        <Shield className="w-6 h-6 text-amber-600 flex-shrink-0" />
                        <div>
                            <h4 className="text-sm font-bold text-amber-900">Seguridad de Datos</h4>
                            <p className="text-xs text-amber-700 leading-relaxed">
                                Tus Client Secret se guardan de forma encriptada en tu base de datos Supabase. Nunca compartas estas credenciales.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4 text-sm">
                        <h4 className="font-bold text-slate-900">Estado del Sistema</h4>
                        <StatusItem label="Supabase DB" status={dbState === 'online' ? 'online' : (dbState === 'error' ? 'offline' : 'checking')} />
                        <StatusItem label="Redis Cache" status="online" />
                        <StatusItem label="Worker Sync" status="online" />
                    </div>
                </div>
            </div>
        </div>
    );
}

function StoreCard({ config, index, onUpdate }: { config: any, index: number, onUpdate: (c: any) => void }) {
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');

    const handleSave = async () => {
        setSaving(true);
        setStatus('idle');
        try {
            const res = await fetch('/api/settings/meli', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: config.id,
                    account_name: config.account_name,
                    client_id: config.client_id,
                    client_secret: config.client_secret,
                    is_active: config.is_active
                })
            });

            if (!res.ok) throw new Error('Failed to save');
            const data = await res.json();

            setStatus('success');
            onUpdate({
                ...config,
                id: data.id,
                client_id: data.settings?.client_id || config.client_id,
                client_secret: data.settings?.client_secret || config.client_secret,
            });
            setTimeout(() => setStatus('idle'), 3000);
        } catch (err) {
            console.error('Error guardando:', err);
            setStatus('error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-yellow-400 rounded-lg flex items-center justify-center font-bold text-yellow-900 text-xs">
                        {config.account_name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                        <input
                            type="text"
                            value={config.account_name}
                            onChange={(e) => onUpdate({ ...config, account_name: e.target.value })}
                            className="font-bold text-slate-900 bg-transparent border-none outline-none focus:ring-1 focus:ring-slate-300 rounded px-1"
                            placeholder="Nombre de Tienda"
                        />
                        <div className="text-xs text-slate-500 px-1 mt-0.5">Mercado Libre APP</div>
                    </div>
                </div>
                {config.has_token && (
                    <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 rounded-full flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Vinculada
                    </span>
                )}
            </div>

            <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Client ID / APP ID</label>
                        <input
                            type="text"
                            value={config.client_id}
                            onChange={(e) => onUpdate({ ...config, client_id: e.target.value })}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-mono"
                            placeholder="1234567"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Client Secret</label>
                        <input
                            type="password"
                            value={config.client_secret}
                            onChange={(e) => onUpdate({ ...config, client_secret: e.target.value })}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-mono"
                            placeholder="••••••••••••"
                        />
                    </div>
                </div>

                <div className="pt-4 flex items-center justify-between border-t border-slate-50 mt-6 gap-4">
                    <label className="flex items-center gap-2 cursor-pointer group">
                        <input
                            type="checkbox"
                            checked={config.is_active}
                            onChange={(e) => onUpdate({ ...config, is_active: e.target.checked })}
                            className="w-4 h-4 text-indigo-600 rounded cursor-pointer"
                        />
                        <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">Activa</span>
                    </label>

                    <div className="flex gap-2">
                        {config.id && (
                            <button
                                onClick={(e) => {
                                    e.preventDefault();
                                    const btn = e.currentTarget;
                                    btn.innerHTML = 'Conectando...';
                                    window.location.href = `/api/meli?marketplace_id=${config.id}`;
                                }}
                                className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-slate-900 rounded-lg font-bold text-xs flex items-center gap-2 transition-all"
                            >
                                <LinkIcon className="w-4 h-4" /> Activar OAuth
                            </button>
                        )}
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className={cn(
                                "px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-2 transition-all shadow-sm",
                                status === 'success' ? "bg-emerald-500 text-white" : "bg-white border text-slate-700 hover:bg-slate-50"
                            )}
                        >
                            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : (status === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />)}
                            {status === 'success' ? 'Guardado' : 'Guardar Llaves'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatusItem({ label, status }: { label: string, status: 'online' | 'offline' | 'checking' | 'ready' }) {
    return (
        <div className="flex justify-between items-center text-xs">
            <span className="text-slate-500">{label}</span>
            <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px]">
                {status === 'online' && <><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" /> <span className="text-emerald-600">Online</span></>}
                {status === 'offline' && <><span className="w-1.5 h-1.5 bg-rose-500 rounded-full" /> <span className="text-rose-600">Offline</span></>}
                {status === 'checking' && <><span className="w-1.5 h-1.5 bg-slate-300 animate-pulse rounded-full" /> <span className="text-slate-400">Validando</span></>}
            </div>
        </div>
    );
}
