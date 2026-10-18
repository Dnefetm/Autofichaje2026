'use client';
import { useRef, useState } from 'react';
import { FileUp, Loader2 } from 'lucide-react';
import { obtenerAdapter, mergeFilas } from '@/lib/proveedor-adapter';
import { registrarAdaptadoresProveedores } from '@/lib/adapters';

// Registro idempotente de adapters (Urrea + Wurth + Tuk)
registrarAdaptadoresProveedores();

/**
 * Botones para subir feeds complementarios (existencias PDF → stock, SAT PDF → codigo_sat).
 * El PDF se PARSEA EN EL NAVEGADOR (CPU del cliente, no Vercel); solo se envían las filas
 * extraídas a /api/precios/importar/feed-pdf para el upsert en catalogo_proveedor.
 */
export function SubirFeedPdf({ proveedor }: { proveedor: string }) {
    const [tipo, setTipo] = useState<'existencias' | 'sat' | null>(null);
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    function pick(t: 'existencias' | 'sat') {
        setTipo(t);
        setMsg(null);
        inputRef.current?.click();
    }

    async function onFile(f: File) {
        if (!tipo) return;
        setLoading(true);
        setMsg(null);
        try {
            if (!f.name.toLowerCase().endsWith('.pdf')) throw new Error('Solo archivos .pdf');
            const adapter = obtenerAdapter(proveedor);
            if (!adapter) throw new Error(`No hay adapter para "${proveedor}"`);

            // 1) Parsear EN EL NAVEGADOR (pdfjs-dist en el cliente)
            const buf = new Uint8Array(await f.arrayBuffer());
            const filas = await adapter.parse({ nombre: f.name, buffer: buf, tipo: 'pdf', feed: tipo });
            if (!filas.length) throw new Error('No se extrajeron filas del archivo');

            // 2) Merge por (proveedor, sku_norm) en el cliente
            const merged = mergeFilas(filas);
            const payload = [...merged.values()].map((x) => ({
                proveedor: x.proveedor,
                sku_norm: x.sku_norm,
                sku_proveedor: x.sku_proveedor,
                descripcion: x.descripcion ?? null,
                stock: x.stock ?? null,
                codigo_sat: x.codigo_sat ?? null,
            }));

            // 3) Solo enviar filas (sin archivo) al backend para el upsert
            const r = await fetch('/api/precios/importar/feed-pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ proveedor: adapter.nombre, tipo, filas: payload, nombre: f.name }),
            });
            const d = await r.json();
            if (!d.ok) throw new Error(d.error);
            setMsg(`✓ ${tipo === 'existencias' ? 'Existencias' : 'SAT'}: ${Number(d.filas || 0).toLocaleString()} filas`);
        } catch (e: any) {
            setMsg(`✗ ${e.message || 'Error procesando el PDF'}`);
        } finally {
            setLoading(false);
            setTipo(null);
        }
    }

    return (
        <span className="flex items-center gap-2 shrink-0">
            <input
                ref={inputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
            />
            <button
                onClick={() => pick('existencias')}
                disabled={loading}
                className="bg-[var(--surface-2)] hover:bg-[var(--bg)] text-[var(--text)] px-3 py-2 rounded-lg font-bold shadow-sm transition-all flex items-center text-sm disabled:opacity-50"
            >
                {loading && tipo === 'existencias' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileUp className="w-4 h-4 mr-1" />}
                Existencias
            </button>
            <button
                onClick={() => pick('sat')}
                disabled={loading}
                className="bg-[var(--surface-2)] hover:bg-[var(--bg)] text-[var(--text)] px-3 py-2 rounded-lg font-bold shadow-sm transition-all flex items-center text-sm disabled:opacity-50"
            >
                {loading && tipo === 'sat' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileUp className="w-4 h-4 mr-1" />}
                SAT
            </button>
            {msg && <span className="text-xs text-[var(--text-muted)] max-w-[240px] truncate" title={msg}>{msg}</span>}
        </span>
    );
}
