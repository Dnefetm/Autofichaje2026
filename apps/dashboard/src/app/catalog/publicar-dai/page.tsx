"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Btn } from '@/components/ui/Btn';
import { Page } from '@/components/ui/Page';
import { Search, Package, CheckCircle2, ExternalLink } from 'lucide-react';
import Link from 'next/link';

interface FilaDai {
    sku_proveedor: string;
    descripcion: string;
    valor: number;
    codigo_barra: string;
}

export default function PublicarDaiPage() {
    const [filas, setFilas] = useState<FilaDai[]>([]);
    const [busqueda, setBusqueda] = useState('');
    const [loading, setLoading] = useState(false);
    const [preparando, setPreparando] = useState<string | null>(null);
    const [resultado, setResultado] = useState<Record<string, any>>({});
    const [error, setError] = useState<string | null>(null);
    const [proveedor, setProveedor] = useState('DAI Autopartes');

    useEffect(() => {
        const sp = new URLSearchParams(window.location.search);
        const p = sp.get('proveedor') || 'DAI Autopartes';
        setProveedor(p);
        cargar('', p);
    }, []);

    async function cargar(term: string, prov: string = proveedor) {
        setLoading(true); setError(null);
        let q = supabase
            .from('precios_proveedor')
            .select('sku_proveedor, descripcion, valor, codigo_barra')
            .eq('proveedor', prov)
            .eq('vigente', true)
            .order('sku_proveedor', { ascending: true })
            .limit(200);
        if (term.trim()) {
            q = q.or(`sku_proveedor.ilike.%${term.trim()}%,descripcion.ilike.%${term.trim()}%`);
        }
        const { data, error: err } = await q;
        if (err) setError(err.message); else setFilas((data as FilaDai[]) || []);
        setLoading(false);
    }

    async function preparar(sku: string) {
        setPreparando(sku); setError(null);
        try {
            const r = await fetch('/api/dai/preparar', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sku, proveedor }),
            });
            const d = await r.json();
            setResultado((prev) => ({ ...prev, [sku]: d }));
        } catch (e: any) {
            setError(e.message);
        } finally {
            setPreparando(null);
        }
    }

    return (
        <div className="flex-1 overflow-auto bg-[var(--bg)] min-h-screen">
            <Page>
                <PageHeader
                    title="Publicar DAI (desde lista de precios)"
                    description="Elige un código DAI, se enriquece desde dai.com.mx y se crea el artículo para publicar en MeLi."
                    actions={<></>}
                />
                <Card className="p-4 space-y-4">
                    <div className="flex items-center gap-2">
                        <Search className="w-4 h-4 text-[var(--text-faint)]" />
                        <input
                            type="text"
                            placeholder="Buscar por código DAI o descripción…"
                            value={busqueda}
                            onChange={(e) => setBusqueda(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && cargar(busqueda)}
                            className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:ring-2 focus:ring-[var(--accent)]"
                        />
                        <Btn variant="ghost" onClick={() => cargar(busqueda)} disabled={loading}>Buscar</Btn>
                    </div>
                    {error && <p className="text-sm text-[var(--err)]">{error}</p>}

                    <div className="overflow-x-auto border border-[var(--border)] rounded-lg">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-[var(--bg)] text-[var(--text-muted)] border-b border-[var(--border)]">
                                <tr>
                                    <th className="px-3 py-2 text-xs uppercase">Código</th>
                                    <th className="px-3 py-2 text-xs uppercase">Descripción</th>
                                    <th className="px-3 py-2 text-xs uppercase">EAN</th>
                                    <th className="px-3 py-2 text-xs uppercase">Costo</th>
                                    <th className="px-3 py-2 text-xs uppercase text-right">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                                {loading ? (
                                    <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-faint)]">Cargando…</td></tr>
                                ) : filas.length === 0 ? (
                                    <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-faint)]">Sin resultados.</td></tr>
                                ) : (
                                    filas.map((f) => {
                                        const r = resultado[f.sku_proveedor];
                                        return (
                                            <tr key={f.sku_proveedor} className="hover:bg-[var(--bg)]/60">
                                                <td className="px-3 py-2 font-mono font-semibold">{f.sku_proveedor}</td>
                                                <td className="px-3 py-2 max-w-md">
                                                    <div className="line-clamp-2">{f.descripcion}</div>
                                                    {r?.imagen && <img src={r.imagen} alt="" className="mt-1 w-10 h-10 object-contain border border-[var(--border)] rounded" />}
                                                </td>
                                                <td className="px-3 py-2 font-mono text-[var(--text-faint)]">{f.codigo_barra?.replace(/^'+/, '') || '—'}</td>
                                                <td className="px-3 py-2 font-mono">${Number(f.valor).toFixed(2)}</td>
                                                <td className="px-3 py-2 text-right">
                                                    {r?.ok ? (
                                                        <Link href={`/catalog/${r.articulo_id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] hover:underline">
                                                            <CheckCircle2 className="w-3.5 h-3.5" /> Listo ({r.aplicaciones?.length ?? 0} apps) · Abrir ficha <ExternalLink className="w-3 h-3" />
                                                        </Link>
                                                    ) : (
                                                        <Btn size="sm" onClick={() => preparar(f.sku_proveedor)} loading={preparando === f.sku_proveedor}>
                                                            {preparando === f.sku_proveedor ? 'Preparando…' : 'Preparar'}
                                                        </Btn>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </Page>
        </div>
    );
}
