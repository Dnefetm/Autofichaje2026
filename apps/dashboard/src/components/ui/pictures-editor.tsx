"use client";

import { useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Save, Loader2 } from 'lucide-react';

interface Props {
    pubId: string;
    pictures: string[];
    onSaved: (pictures: string[]) => void;
}

/**
 * PicturesEditor — galería de fotos editable inline.
 * Permite reordenar, quitar, agregar URL y guardar (un solo PATCH con la lista final).
 */
export function PicturesEditor({ pubId, pictures, onSaved }: Props) {
    const [urls, setUrls] = useState<string[]>(pictures);
    const [newUrl, setNewUrl] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [dirty, setDirty] = useState(false);

    function addUrl() {
        const u = newUrl.trim();
        if (!u || !u.startsWith('http')) { setError('La URL debe empezar con http'); return; }
        if (urls.includes(u)) { setError('Esa URL ya está'); return; }
        setUrls([...urls, u]);
        setNewUrl('');
        setError('');
        setDirty(true);
    }
    function remove(i: number) { setUrls(urls.filter((_, j) => j !== i)); setDirty(true); }
    function move(i: number, dir: -1 | 1) {
        setUrls(prev => {
            const t = i + dir;
            if (t < 0 || t >= prev.length) return prev;
            const next = [...prev];
            [next[i], next[t]] = [next[t], next[i]];
            return next;
        });
        setDirty(true);
    }

    async function save() {
        if (saving) return;
        setSaving(true);
        setError('');
        try {
            const res = await fetch(`/api/vitrinas/${pubId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ changes: [{ field: 'pictures', value: urls }] }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al sincronizar');
            const r = Array.isArray(data.applied) ? data.applied.find((a: any) => a.field === 'pictures') : null;
            if (r && !r.ok) throw new Error(r.error || 'MeLi rechazó el cambio');
            onSaved(urls);
            setDirty(false);
        } catch (e: any) {
            setError(e?.message || 'Error al guardar fotos');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {urls.map((u, i) => (
                    <div key={i} className="relative aspect-square rounded-lg border border-[var(--border)] overflow-hidden group">
                        <img src={u} alt="" className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.opacity = '0.2')} />
                        <span className="absolute top-1 left-1 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">#{i + 1}</span>
                        <div className="absolute bottom-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 bg-black/60 text-white rounded disabled:opacity-30" title="Subir"><ArrowUp className="w-3 h-3" /></button>
                            <button onClick={() => move(i, 1)} disabled={i === urls.length - 1} className="p-1 bg-black/60 text-white rounded disabled:opacity-30" title="Bajar"><ArrowDown className="w-3 h-3" /></button>
                            <button onClick={() => remove(i)} className="p-1 bg-[var(--err)]/80 text-white rounded" title="Quitar"><Trash2 className="w-3 h-3" /></button>
                        </div>
                    </div>
                ))}
            </div>
            {urls.length === 0 && <p className="text-xs text-[var(--text-faint)]">Sin fotos.</p>}

            <div className="flex gap-2">
                <input
                    type="url"
                    value={newUrl}
                    onChange={(e) => { setNewUrl(e.target.value); setError(''); }}
                    onKeyDown={(e) => e.key === 'Enter' && addUrl()}
                    placeholder="https://... URL de imagen"
                    className="flex-1 h-10 px-3 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)]"
                />
                <button onClick={addUrl} className="h-10 px-3 text-sm font-bold bg-[var(--surface-2)] border border-[var(--border)] rounded-lg flex items-center gap-1"><Plus className="w-4 h-4" /> Agregar</button>
            </div>

            <div className="flex items-center gap-3">
                <button
                    onClick={save}
                    disabled={saving || !dirty}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-[var(--accent)] rounded-lg disabled:opacity-40"
                >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {saving ? 'Guardando…' : 'Guardar fotos'}
                </button>
                {dirty && <span className="text-[10px] text-[var(--accent)] font-bold">● cambios sin guardar</span>}
            </div>

            {error && <p className="text-[10px] text-[var(--err)] break-words">{error}</p>}
        </div>
    );
}
