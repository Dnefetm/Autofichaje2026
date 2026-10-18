'use client';
import { useEffect, useState } from 'react';
import { Settings2, Loader2 } from 'lucide-react';

/**
 * Configuración rápida de la política de stock del proveedor (dropdown en el hub).
 * modos: fisico (inventario actual) | fijo (dropship) | proveedor (fracción del PDF) | manual.
 */
export function PoliticaStockConfig({ proveedor }: { proveedor: string }) {
    const [open, setOpen] = useState(false);
    const [modo, setModo] = useState('fisico');
    const [stockFijo, setStockFijo] = useState('10');
    const [fraccion, setFraccion] = useState('0.2');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        let cancel = false;
        (async () => {
            setLoading(true);
            try {
                const r = await fetch(`/api/precios/proveedor/${encodeURIComponent(proveedor)}/stock-politica`);
                const d = await r.json();
                if (!cancel && d.ok && d.politica) {
                    setModo(String(d.politica.modo || 'fisico'));
                    setStockFijo(String(d.politica.stock_fijo ?? 10));
                    setFraccion(String(d.politica.fraccion_maxima ?? 0.2));
                }
            } catch { /* sin política aún */ }
            finally { if (!cancel) setLoading(false); }
        })();
        return () => { cancel = true; };
    }, [open, proveedor]);

    async function guardar() {
        setSaving(true);
        setMsg(null);
        try {
            const r = await fetch(`/api/precios/proveedor/${encodeURIComponent(proveedor)}/stock-politica`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modo, stock_fijo: Number(stockFijo), fraccion_maxima: Number(fraccion) }),
            });
            const d = await r.json();
            if (!d.ok) throw new Error(d.error);
            setMsg('✓ Guardada');
            setTimeout(() => setOpen(false), 800);
        } catch (e: any) {
            setMsg(`✗ ${e.message || 'Error'}`);
        } finally {
            setSaving(false);
        }
    }

    return (
        <span className="relative">
            <button
                onClick={() => setOpen((o) => !o)}
                className="bg-[var(--surface-2)] hover:bg-[var(--bg)] text-[var(--text)] px-3 py-2 rounded-lg font-bold shadow-sm transition-all flex items-center text-sm"
                title="Política de stock"
            >
                <Settings2 className="w-4 h-4 mr-1" /> Stock
            </button>
            {open && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg p-3 z-50 space-y-2 text-left">
                    <label className="block text-xs text-[var(--text-muted)]">Modo de stock</label>
                    <select
                        value={modo}
                        onChange={(e) => setModo(e.target.value)}
                        className="w-full px-2 py-1.5 text-sm border border-[var(--border)] rounded-lg bg-[var(--bg)] text-[var(--text)]"
                    >
                        <option value="fisico">Físico (inventario actual)</option>
                        <option value="fijo">Fijo (dropship)</option>
                        <option value="proveedor">Proveedor (fracción del PDF)</option>
                        <option value="manual">Manual</option>
                    </select>

                    {modo === 'fijo' && (
                        <label className="block text-xs">
                            <span className="text-[var(--text-muted)]">Stock fijo</span>
                            <input
                                type="number" min="0" value={stockFijo}
                                onChange={(e) => setStockFijo(e.target.value)}
                                className="w-full px-2 py-1.5 text-sm border border-[var(--border)] rounded-lg bg-[var(--bg)] text-[var(--text)]"
                            />
                        </label>
                    )}
                    {modo === 'proveedor' && (
                        <label className="block text-xs">
                            <span className="text-[var(--text-muted)]">Fracción máxima (1/5 = 0.2)</span>
                            <input
                                type="number" min="0.01" max="1" step="0.01" value={fraccion}
                                onChange={(e) => setFraccion(e.target.value)}
                                className="w-full px-2 py-1.5 text-sm border border-[var(--border)] rounded-lg bg-[var(--bg)] text-[var(--text)]"
                            />
                        </label>
                    )}

                    <div className="flex items-center justify-between pt-1">
                        {msg ? <span className="text-xs text-[var(--text-muted)]">{msg}</span> : <span />}
                        <button
                            onClick={guardar}
                            disabled={saving || loading}
                            className="bg-[var(--accent)] text-[var(--accent-ink)] px-3 py-1.5 rounded-lg text-sm font-bold disabled:opacity-50 flex items-center gap-1"
                        >
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Guardar
                        </button>
                    </div>
                </div>
            )}
        </span>
    );
}
