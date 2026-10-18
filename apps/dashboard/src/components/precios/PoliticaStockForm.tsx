'use client';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Formulario de política de stock integrado en /precios/[proveedor]/reglas.
 * Lee/guarda vía /api/precios/proveedor/[proveedor]/stock-politica.
 */
export function PoliticaStockForm({ proveedor }: { proveedor: string }) {
    const [modo, setModo] = useState('fisico');
    const [stockFijo, setStockFijo] = useState('10');
    const [fraccion, setFraccion] = useState('0.2');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    useEffect(() => {
        let cancel = false;
        (async () => {
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
    }, [proveedor]);

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
            setMsg('✓ Política guardada');
        } catch (e: any) {
            setMsg(`✗ ${e.message || 'Error al guardar'}`);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-sm p-8 mt-6">
            <h3 className="text-lg font-bold text-[var(--text)] mb-1">Política de Stock</h3>
            <p className="text-[var(--text-muted)] text-sm mb-4">Define cuánto stock se publica para los productos de {proveedor}.</p>

            <div className="space-y-3 max-w-sm">
                <label className="block text-sm">
                    <span className="text-[var(--text-muted)]">Modo</span>
                    <select
                        value={modo}
                        onChange={(e) => setModo(e.target.value)}
                        className="mt-1 w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--bg)] text-[var(--text)]"
                    >
                        <option value="fisico">Físico (inventario actual)</option>
                        <option value="fijo">Fijo (dropship)</option>
                        <option value="proveedor">Proveedor (fracción del reporte)</option>
                        <option value="manual">Manual</option>
                    </select>
                </label>

                {modo === 'fijo' && (
                    <label className="block text-sm">
                        <span className="text-[var(--text-muted)]">Stock fijo</span>
                        <input
                            type="number" min="0" value={stockFijo}
                            onChange={(e) => setStockFijo(e.target.value)}
                            className="mt-1 w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--bg)] text-[var(--text)]"
                        />
                    </label>
                )}
                {modo === 'proveedor' && (
                    <label className="block text-sm">
                        <span className="text-[var(--text-muted)]">Fracción máxima (1/5 = 0.2)</span>
                        <input
                            type="number" min="0.01" max="1" step="0.01" value={fraccion}
                            onChange={(e) => setFraccion(e.target.value)}
                            className="mt-1 w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--bg)] text-[var(--text)]"
                        />
                    </label>
                )}

                <div className="flex items-center gap-3 pt-1">
                    <button
                        onClick={guardar}
                        disabled={saving || loading}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] text-sm font-bold hover:brightness-110 transition disabled:opacity-50"
                    >
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />} Guardar
                    </button>
                    {msg && <span className="text-sm text-[var(--text-muted)]">{msg}</span>}
                </div>
            </div>
        </div>
    );
}
