"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Search, Filter, RefreshCw, AlertCircle, CheckCircle2, Link2 } from 'lucide-react';
import MappingModal from '@/components/mapping-modal';

export default function VirtualCatalogPage() {
    const [listings, setListings] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedListing, setSelectedListing] = useState<any | null>(null);

    const [syncing, setSyncing] = useState(false);
    const [syncProgress, setSyncProgress] = useState<string | null>(null);
    const [debugLogs, setDebugLogs] = useState<string[]>([]);

    const addLog = (msg: string) => {
        const time = new Date().toLocaleTimeString();
        setDebugLogs(prev => [...prev, `[${time}] ${msg}`]);
        setSyncProgress(msg);
    };

    useEffect(() => {
        loadListings();
    }, []);

    async function loadListings() {
        setLoading(true);
        try {
            // Unimos con marketplace_configs para saber de qué tienda es cada publicación
            const { data, error } = await supabase
                .from('publicaciones_externas')
                .select(`
                    *,
                    marketplace:marketplace_configs (account_name)
                `)
                .order('esta_mapeado', { ascending: true }) // Mostrar los desmapeados primero
                .order('creado_el', { ascending: false });

            if (error) throw error;
            setListings(data || []);
        } catch (error) {
            console.error('Error fetching listings:', error);
        } finally {
            setLoading(false);
        }
    }

    async function handleForceSync() {
        setSyncing(true);
        setDebugLogs([]);
        addLog('Iniciando sincronización Serverless...');

        try {
            // 1. Obtener tiendas del usuario conectadas (Front-end bypass)
            addLog('Conectando a base de datos (tiendas)...');
            const { data: configs, error: configsErr } = await supabase
                .from('marketplace_configs')
                .select('id, account_name')
                .eq('is_active', true);

            if (configsErr) throw configsErr;
            if (!configs || configs.length === 0) {
                addLog('ERROR: No hay tiendas activas vinculadas.');
                setSyncing(false);
                return;
            }

            let totalGeneral = 0;

            for (const config of configs) {
                let hasMore = true;
                let currentOffset = 0;

                addLog(`Tienda encontrada: ${config.account_name}`);

                // Relays Infinitos con scroll (modo scan de MeLi)
                let currentScrollId: string | null = null;
                let relayCount = 0;
                while (hasMore) {
                    relayCount++;
                    addLog(`Solicitando a Serverless API -> Tienda: ${config.account_name} | Relay #${relayCount}`);

                    const res = await fetch('/api/sync/manual', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ accountId: config.id, scrollId: currentScrollId })
                    });

                    // Atrapando el Error Crudo 500 de Vercel
                    const text = await res.text();
                    let result;
                    try {
                        result = JSON.parse(text);
                    } catch (e) {
                        throw new Error(`CRASH VERCEL (HTML 500): ${text.substring(0, 200)}`);
                    }

                    if (!res.ok) {
                        throw new Error(`Error de Servidor: ${result.error || result.message}`);
                    }

                    const delta = result.totalProcessed || result.processedSoFar || 0;
                    if (delta > 0) {
                        totalGeneral += delta;
                        addLog(`+${delta} artículos depositados. Total acumulado: ${totalGeneral}`);
                    }

                    if (result.hasMore) {
                        hasMore = true;
                        currentScrollId = result.scrollId || null;
                        addLog(`Vercel solicitó PAUSA estratégica. Relevando con scroll_id...`);
                        await new Promise(r => setTimeout(r, 800));
                    } else {
                        addLog(`✓ Tienda ${config.account_name} terminada al 100%.`);
                        hasMore = false;
                    }
                }
            }

            addLog(`¡Éxito Total! ${totalGeneral} ítems guardados.`);
            setTimeout(() => setSyncProgress(null), 4000);
            loadListings(); // Recargar visualmente el catálogo

        } catch (error: any) {
            console.error(error);
            addLog(`❌ ABORTO: ${error.message}`);
        } finally {
            setSyncing(false);
        }
    }

    const filteredListings = listings.filter(l =>
        l.titulo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        l.external_item_id.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="flex-1 overflow-auto bg-slate-50 min-h-screen">
            <div className="p-8 pb-32 max-w-7xl mx-auto space-y-6">

                {/* Cabecera */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Vitrinas de Mercado Libre</h1>
                        <p className="text-slate-500 mt-1">
                            Anuncios descargados. Debes mapearlos a productos de tu Bodega (Catálogo Maestro).
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleForceSync}
                            disabled={syncing}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 border border-transparent text-white rounded-lg hover:bg-indigo-700 shadow-sm disabled:opacity-50"
                        >
                            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                            {syncing ? 'Forzando Sync...' : 'Forzar Sincronización ML'}
                        </button>
                        <button
                            onClick={loadListings}
                            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 shadow-sm"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Actualizar Vista
                        </button>
                    </div>
                </div>

                {/* Buscador y Filtros */}
                <div className="flex gap-4 items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                    <div className="flex-1 relative">
                        <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Buscar por MLM o título de la publicación..."
                            className="w-full pl-10 pr-4 py-2 bg-slate-50 border-none rounded-lg focus:ring-2 focus:ring-indigo-500"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <button className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200">
                        <Filter className="w-4 h-4" />
                        Filtros
                    </button>
                </div>

                {/* Tabla de Resultados */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                                <tr>
                                    <th className="px-6 py-4 font-semibold">Estado de Mapeo</th>
                                    <th className="px-6 py-4 font-semibold">Publicación (Vitrina)</th>
                                    <th className="px-6 py-4 font-semibold">Cuenta / Tienda</th>
                                    <th className="px-6 py-4 font-semibold">Precio & Stock</th>
                                    <th className="px-6 py-4 font-semibold text-right">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {loading ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                                            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                                            Cargando catálogo virtual...
                                        </td>
                                    </tr>
                                ) : filteredListings.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                                            No se encontraron publicaciones. Enciende el script de sincronización.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredListings.map(listing => (
                                        <tr key={listing.id} className="hover:bg-slate-50 transition-colors group">
                                            {/* Estado Mapeo */}
                                            <td className="px-6 py-4">
                                                {listing.esta_mapeado ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                                        Mapeado
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                                                        <AlertCircle className="w-3.5 h-3.5" />
                                                        Sin Mapear
                                                    </span>
                                                )}
                                            </td>

                                            {/* Publicación Info */}
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    {listing.url_imagen ? (
                                                        <img src={listing.url_imagen} alt="Thumbnail" className="w-10 h-10 rounded-md object-cover border border-slate-200" />
                                                    ) : (
                                                        <div className="w-10 h-10 rounded-md bg-slate-100 border border-slate-200" />
                                                    )}
                                                    <div>
                                                        <a href={listing.permalink} target="_blank" rel="noreferrer" className="text-sm font-medium text-slate-900 hover:text-indigo-600 truncate max-w-[250px] block">
                                                            {listing.titulo}
                                                        </a>
                                                        <p className="text-xs text-slate-500 mt-0.5">{listing.external_item_id}</p>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Tienda */}
                                            <td className="px-6 py-4">
                                                <span className="text-xs font-medium bg-slate-100 px-2.5 py-1 rounded-md text-slate-700">
                                                    {listing.marketplace?.account_name || 'Desconocida'}
                                                </span>
                                            </td>

                                            {/* Precio & Stock */}
                                            <td className="px-6 py-4">
                                                <div className="text-sm font-medium text-slate-900">${listing.precio_venta}</div>
                                                <div className="text-xs text-slate-500 mt-0.5">{listing.stock_publicado} en ML</div>
                                            </td>

                                            {/* Acción */}
                                            <td className="px-6 py-4 text-right">
                                                <button
                                                    onClick={() => setSelectedListing(listing)}
                                                    className="inline-flex justify-center items-center gap-2 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm font-medium rounded-lg transition-colors border border-indigo-200"
                                                >
                                                    <Link2 className="w-4 h-4" />
                                                    {listing.esta_mapeado ? 'Editar Mapeo' : 'Crear Enlace (Kit)'}
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>

            {/* Consola de Debug - Logs en Vivo */}
            {debugLogs.length > 0 && (
                <div className="fixed bottom-0 left-64 right-0 bg-slate-900 border-t border-slate-700 p-4 max-h-60 overflow-y-auto z-40">
                    <div className="flex justify-between items-center mb-2">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Consola de Sincronización</h4>
                        <button
                            onClick={() => setDebugLogs([])}
                            className="text-xs text-slate-500 hover:text-slate-300"
                        >
                            Limpiar
                        </button>
                    </div>
                    <div className="font-mono text-xs space-y-0.5">
                        {debugLogs.map((log, i) => (
                            <div key={i} className={log.includes('❌') || log.includes('ERROR') ? 'text-red-400' : log.includes('✓') || log.includes('Éxito') ? 'text-green-400' : 'text-green-300'}>
                                {log}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Modal de Mapeo Flotante */}
            {selectedListing && (
                <MappingModal
                    listing={selectedListing}
                    onClose={() => setSelectedListing(null)}
                    onSuccess={() => {
                        setSelectedListing(null);
                        loadListings(); // Recargar tabla para ver el check verde
                    }}
                />
            )}
        </div>
    );
}
