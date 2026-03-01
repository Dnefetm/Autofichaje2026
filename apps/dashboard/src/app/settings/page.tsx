"use client";

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
    const [config, setConfig] = useState<any>({
        id: '',
        account_name: 'Mi Tienda Principal',
        marketplace: 'meli',
        client_id: '',
        client_secret: '',
        is_active: true
    });
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');

    useEffect(() => {
        async function loadConfig() {
            const { data } = await supabase
                .from('marketplace_configs')
                .select('*')
                .eq('marketplace', 'meli')
                .single();

            if (data) {
                setConfig({
                    ...data,
                    client_id: data.settings?.client_id || '',
                    client_secret: data.settings?.client_secret || ''
                });
            }
        }
        loadConfig();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setStatus('idle');
        try {
            console.log('Guardando configuración...', config);
            const { data, error } = await supabase
                .from('marketplace_configs')
                .upsert({
                    account_name: config.account_name,
                    marketplace: 'meli',
                    is_active: config.is_active,
                    settings: {
                        client_id: config.client_id,
                        client_secret: config.client_secret
                    }
                }, { onConflict: 'marketplace' })
                .select()
                .single();

            if (error) {
                console.error('Error en upsert:', error);
                throw error;
            }

            if (data) {
                console.log('Configuración guardada exitosamente:', data.id);
                setConfig((prev: any) => ({
                    ...prev,
                    id: data.id,
                    client_id: data.settings?.client_id || prev.client_id,
                    client_secret: data.settings?.client_secret || prev.client_secret
                }));
                setStatus('success');
                // Forzar un guardado local si es necesario para asegurar visualización inmediata
                localStorage.setItem('last_meli_id', data.id);
            }
        } catch (err) {
            console.error('Error detallado:', err);
            setStatus('error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="max-w-4xl space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">Configuración del Sistema</h2>
                <p className="text-slate-500 text-sm">Conecta tus cuentas reales para activar la sincronización en vivo.</p>
            </div>

            <AuthFeedback />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-6">
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="p-6 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
                            <div className="w-10 h-10 bg-yellow-400 rounded-lg flex items-center justify-center">
                                <LinkIcon className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-900">Mercado Libre APP</h3>
                                <p className="text-xs text-slate-500">Credenciales de tu aplicación en developers.mercadolibre.com</p>
                            </div>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-1 gap-4">
                                <div className="space-y-1">
                                    <label className="text-sm font-semibold text-slate-700">Nombre de la Cuenta</label>
                                    <input
                                        type="text"
                                        value={config.account_name}
                                        onChange={(e) => setConfig({ ...config, account_name: e.target.value })}
                                        className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                                        placeholder="Ej: Ferretería Central MeLi"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-sm font-semibold text-slate-700">Client ID</label>
                                        <input
                                            type="text"
                                            value={config.client_id}
                                            onChange={(e) => setConfig({ ...config, client_id: e.target.value })}
                                            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-mono"
                                            placeholder="1234567890"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-sm font-semibold text-slate-700">Client Secret</label>
                                        <input
                                            type="password"
                                            value={config.client_secret}
                                            onChange={(e) => setConfig({ ...config, client_secret: e.target.value })}
                                            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-mono"
                                            placeholder="••••••••••••••••"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4 flex items-center justify-between border-t border-slate-50 mt-6">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={config.is_active}
                                        onChange={(e) => setConfig({ ...config, is_active: e.target.checked })}
                                        className="w-4 h-4 text-indigo-600 rounded"
                                    />
                                    <span className="text-sm text-slate-600">Sincronización activa</span>
                                </div>
                                <div className="flex gap-3">
                                    {config.id && (
                                        <button
                                            onClick={(e) => {
                                                e.preventDefault();
                                                const finalId = config.id || localStorage.getItem('last_meli_id');
                                                if (!finalId) {
                                                    alert('Por favor, haz clic en "Guardar Llaves" primero para registrar la cuenta antes de vincular.');
                                                    return;
                                                }
                                                // Prevenir múltiples clics
                                                const btn = e.currentTarget;
                                                btn.disabled = true;
                                                btn.innerHTML = 'Redirigiendo...';
                                                window.location.href = `/api/meli?marketplace_id=${finalId}`;
                                            }}
                                            className="px-6 py-2 bg-yellow-400 hover:bg-yellow-500 text-slate-900 rounded-lg font-bold text-sm flex items-center gap-2 transition-all shadow-sm"
                                        >
                                            <LinkIcon className="w-4 h-4" />
                                            Vincular Cuenta MeLi
                                        </button>
                                    )}
                                    <button
                                        onClick={handleSave}
                                        disabled={saving}
                                        className={cn(
                                            "px-6 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition-all shadow-md",
                                            status === 'success' ? "bg-emerald-500 text-white" : "bg-slate-900 text-white hover:bg-slate-800"
                                        )}
                                    >
                                        {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                        {status === 'success' ? 'Datos Guardados' : 'Guardar Llaves'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-4">
                        <Shield className="w-6 h-6 text-amber-600 flex-shrink-0" />
                        <div>
                            <h4 className="text-sm font-bold text-amber-900">Seguridad de Datos</h4>
                            <p className="text-xs text-amber-700 leading-relaxed">
                                Tus Client Secret se guardan de forma segura en tu base de datos Supabase.
                                Nunca compartas estas credenciales fuera de este panel.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4 text-sm">
                        <h4 className="font-bold text-slate-900">Estado de Conexión</h4>
                        <StatusItem label="Supabase DB" status={status === 'success' ? 'online' : 'checking'} />
                        <StatusItem label="Mercado Libre API" status={config.client_id ? 'ready' : 'offline'} />
                        <StatusItem label="Redis Cache" status="online" />
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
                {status === 'ready' && <><span className="w-1.5 h-1.5 bg-blue-500 rounded-full" /> <span className="text-blue-600">Listo</span></>}
                {status === 'checking' && <><span className="w-1.5 h-1.5 bg-slate-300 animate-pulse rounded-full" /> <span className="text-slate-400">Validando</span></>}
            </div>
        </div>
    );
}
