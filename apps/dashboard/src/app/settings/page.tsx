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
    const [dbState, setDbState] = useState<'checking' | 'online' | 'error'>('checking');

    useEffect(() => {
        loadConfigs();
    }, []);

    async function loadConfigs() {
        try {
            const res = await fetch('/api/settings/meli');
            if (!res.ok) throw new Error('Failed to fetch configs');
            const data = await res.json();

            if (Array.isArray(data)) {
                setConfigs(data);
            }
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
        <div className="max-w-4xl space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
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
