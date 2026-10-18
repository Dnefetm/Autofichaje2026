'use client';
import { useRef, useState } from 'react';
import { FileUp, Loader2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase-browser';

/**
 * Botones para subir feeds complementarios (existencias PDF → stock, SAT PDF → codigo_sat)
 * de un proveedor. Flujo: signed-url → upload directo a Storage → /api/precios/importar/feed-pdf.
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

            // 1) Signed URL
            const r1 = await fetch('/api/precios/importar/signed-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ proveedor, fileName: f.name }),
            });
            const j1 = await r1.json();
            if (!j1.ok) throw new Error(j1.error);

            // 2) Upload directo a Storage
            const supabase = supabaseBrowser();
            const { error: upErr } = await supabase.storage.from(j1.bucket).uploadToSignedUrl(j1.path, j1.token, f);
            if (upErr) throw new Error(upErr.message);

            // 3) Procesar (parse + upsert en catalogo_proveedor)
            const r2 = await fetch('/api/precios/importar/feed-pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ proveedor, tipo, storage_path: j1.path, bucket: j1.bucket, nombre: f.name }),
            });
            const j2 = await r2.json();
            if (!j2.ok) throw new Error(j2.error);
            setMsg(`✓ ${tipo === 'existencias' ? 'Existencias' : 'SAT'}: ${Number(j2.filas || 0).toLocaleString()} filas`);
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
            {msg && <span className="text-xs text-[var(--text-muted)] max-w-[220px] truncate" title={msg}>{msg}</span>}
        </span>
    );
}
