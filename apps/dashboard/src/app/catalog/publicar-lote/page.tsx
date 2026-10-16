"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Btn } from '@/components/ui/Btn';
import { Page } from '@/components/ui/Page';
import { Search, Package, CheckCircle2 } from 'lucide-react';

interface Articulo {
    articulo_id: string;
    nombre: string;
    marca: string | null;
    modelo: string | null;
    codigo_universal: string | null;
}

export default function PublicarLotePage() {
    const [accounts, setAccounts] = useState<{ id: string; account_name: string }[]>([]);
    const [accountId, setAccountId] = useState<string>('');
    const [articulos, setArticulos] = useState<Articulo[]>([]);
    const [busqueda, setBusqueda] = useState('');
    const [loading, setLoading] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [resultado, setResultado] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    // articulo_id -> stock (string editable)
    const [seleccion, setSeleccion] = useState<Record<string, string>>({});

    useEffect(() => {
        supabase
            .from('marketplace_configs')
            .select('id, account_name')
            .eq('is_active', true)
            .then(({ data }) => {
                if (data?.length) {
                    setAccounts(data);
                    setAccountId(data[0].id);
                }
            });
        cargar('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function cargar(term: string) {
        setLoading(true);
        setError(null);
        let q = supabase
            .from('articulos')
            .select('articulo_id, nombre, marca, modelo, codigo_universal')
            .order('nombre', { ascending: true })
            .limit(200);
        if (term.trim()) {
            q = q.or(`nombre.ilike.%${term.trim()}%,modelo.ilike.%${term.trim()}%,codigo_universal.ilike.%${term.trim()}%`);
        }
        const { data, error: err } = await q;
        if (err) setError(err.message);
        else setArticulos((data as Articulo[]) || []);
        setLoading(false);
    }

    function toggle(articuloId: string) {
        setSeleccion((prev) => {
            const next = { ...prev };
            if (next[articuloId] !== undefined) delete next[articuloId];
            else next[articuloId] = '1';
            return next;
        });
    }

    function setStock(articuloId: string, valor: string) {
        setSeleccion((prev) => ({ ...prev, [articuloId]: valor }));
    }

    function seleccionados() {
        return Object.entries(seleccion).filter(([, stock]) => stock !== '' && Number(stock) >= 0);
    }

    async function publicarLote() {
        if (!accountId) { setError('Selecciona una cuenta MeLi'); return; }
        const items = seleccionados().map(([articulo_id, stock]) => ({
            articulo_id,
            marketplace_id: accountId,
            stock_override: Number(stock),
            listing_type_id: 'gold_special',
        }));
        if (items.length === 0) { setError('Selecciona al menos un artículo'); return; }

        setEnviando(true);
        setError(null);
        setResultado(null);
        try {
            const res = await fetch('/api/publish/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items }),
            });
            const data = await res.json();
            setResultado({ status: res.status, ...data });
            if (res.ok) setSeleccion({});
        } catch (e: any) {
            setError(e.message);
        } finally {
            setEnviando(false);
        }
    }

    return (
        <div className="flex-1 overflow-auto bg-[var(--bg)] min-h-screen">
            <Page>
                <PageHeader
                    title="Publicar en lote"
                    description={`Selecciona artículos y fija el stock inicial (default 1). Se encolan y el worker los publica uno por uno.`}
                    actions={<></>}
                />

                <Card className="p-4 space-y-4">
                    {/* Cuenta destino */}
                    <div className="flex flex-wrap items-end gap-3">
                        <div>
                            <label className="text-[10px] font-bold uppercase text-[var(--text-faint)] tracking-wider block mb-1.5">Cuenta de destino</label>
                            <select
                                value={accountId}
                                onChange={(e) => setAccountId(e.target.value)}
                                className="px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:ring-2 focus:ring-[var(--accent)]"
                            >
                                {accounts.map((a) => (
                                    <option key={a.id} value={a.id}>{a.account_name}</option>
                                ))}
                            </select>
                        </div>

                        {/* Buscador */}
                        <div className="relative flex-1 min-w-[220px]">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                            <input
                                type="text"
                                placeholder="Buscar por nombre, modelo o GTIN…"
                                value={busqueda}
                                onChange={(e) => setBusqueda(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && cargar(busqueda)}
                                className="w-full pl-9 pr-3 py-2.5 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:ring-2 focus:ring-[var(--accent)]"
                            />
                        </div>
                        <Btn variant="ghost" onClick={() => cargar(busqueda)} disabled={loading}>Buscar</Btn>
                        <Btn onClick={publicarLote} disabled={enviando || seleccionados().length === 0} loading={enviando}>
                            Publicar lote ({seleccionados().length})
                        </Btn>
                    </div>

                    {error && <p className="text-sm text-[var(--err)]">{error}</p>}
                    {resultado && (
                        <div className="p-3 bg-[var(--ok)]/10 border border-[var(--ok)]/30 rounded-lg">
                            <p className="text-sm text-[var(--ok)] font-semibold flex items-center gap-1.5">
                                <CheckCircle2 className="w-4 h-4" /> {resultado.enqueued ?? 0} publicación(es) encolada(s). El worker las procesa una por una.
                            </p>
                        </div>
                    )}

                    {/* Tabla */}
                    <div className="overflow-x-auto border border-[var(--border)] rounded-lg">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-[var(--bg)] text-[var(--text-muted)] border-b border-[var(--border)]">
                                <tr>
                                    <th className="px-3 py-2 text-xs uppercase">Sel.</th>
                                    <th className="px-3 py-2 text-xs uppercase">Artículo</th>
                                    <th className="px-3 py-2 text-xs uppercase">Marca / Modelo</th>
                                    <th className="px-3 py-2 text-xs uppercase">GTIN</th>
                                    <th className="px-3 py-2 text-xs uppercase w-28">Stock inicial</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                                {loading ? (
                                    <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-faint)]">Cargando…</td></tr>
                                ) : articulos.length === 0 ? (
                                    <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-faint)]">Sin resultados.</td></tr>
                                ) : (
                                    articulos.map((a) => {
                                        const selected = seleccion[a.articulo_id] !== undefined;
                                        return (
                                            <tr key={a.articulo_id} className="hover:bg-[var(--bg)]/60">
                                                <td className="px-3 py-2">
                                                    <input type="checkbox" checked={selected} onChange={() => toggle(a.articulo_id)} className="w-4 h-4 rounded text-[var(--accent)]" />
                                                </td>
                                                <td className="px-3 py-2 max-w-xs">
                                                    <div className="flex items-start gap-2">
                                                        <Package className="w-4 h-4 text-[var(--text-faint)] mt-0.5 shrink-0" />
                                                        <span className="line-clamp-2 leading-tight">{a.nombre}</span>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2 text-xs text-[var(--text-muted)]">
                                                    {[a.marca, a.modelo].filter(Boolean).join(' · ') || '—'}
                                                </td>
                                                <td className="px-3 py-2 text-xs font-mono text-[var(--text-faint)]">{a.codigo_universal || '—'}</td>
                                                <td className="px-3 py-2">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        disabled={!selected}
                                                        value={selected ? seleccion[a.articulo_id] : '1'}
                                                        onChange={(e) => setStock(a.articulo_id, e.target.value)}
                                                        className="w-full px-2 py-1.5 text-sm border border-[var(--border)] rounded-md bg-[var(--surface)] font-mono disabled:opacity-40"
                                                    />
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
