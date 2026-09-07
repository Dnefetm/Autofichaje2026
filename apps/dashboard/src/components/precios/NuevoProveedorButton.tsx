'use client';
import { toast } from 'sonner';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Loader2 } from 'lucide-react';

export function NuevoProveedorButton() {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [nombre, setNombre] = useState('');
    const [loading, setLoading] = useState(false);

    const handleCrear = async () => {
        const n = nombre.trim();
        if (!n) { toast.error('Escribe el nombre del proveedor'); return; }
        setLoading(true);
        try {
            const res = await fetch('/api/precios/proveedores', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre: n })
            });
            const data = await res.json();
            if (!res.ok) { toast.error(data.error || 'No se pudo crear el proveedor'); setLoading(false); return; }
            toast.success(`Proveedor "${n}" creado. Sube su lista de precios.`);
            router.push(`/precios/${encodeURIComponent(n)}/subir`);
        } catch (e) {
            toast.error('Error de red');
            setLoading(false);
        }
    };

    return (
        <div className="relative">
            <button
                onClick={() => setOpen(o => !o)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[var(--accent)] text-[var(--accent-ink)] rounded-lg font-bold shadow-sm hover:brightness-110 transition-all text-sm"
            >
                <Plus className="w-4 h-4" /> Nuevo proveedor
            </button>
            {open && (
                <div className="absolute right-0 mt-2 w-80 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-lg p-4 z-30">
                    <label className="block text-xs font-bold text-[var(--text-muted)] mb-1">Nombre del proveedor</label>
                    <input
                        autoFocus
                        type="text"
                        value={nombre}
                        onChange={e => setNombre(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleCrear(); }}
                        placeholder="ej. Victorinox"
                        className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--bg)] text-sm focus:ring-2 focus:ring-[var(--accent)] outline-none text-[var(--text)]"
                    />
                    <div className="flex justify-end gap-2 mt-3">
                        <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-sm text-[var(--text-muted)] hover:bg-[var(--bg)] rounded-lg">Cancelar</button>
                        <button
                            onClick={handleCrear}
                            disabled={loading || !nombre.trim()}
                            className="inline-flex items-center gap-1 px-4 py-1.5 bg-[var(--accent)] text-[var(--accent-ink)] rounded-lg text-sm font-bold hover:brightness-110 disabled:opacity-50"
                        >
                            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            Crear y subir lista
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
