"use client";

import { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Save, Loader2, Upload, Wand2 } from 'lucide-react';
import { measureImage, meetsMeliSize, upscaleImage, ImageSize } from '@/lib/image-utils';

interface Props {
    pubId: string;
    pictures: string[];
    onSaved: (pictures: string[]) => void;
}

/**
 * PicturesEditor — galería de fotos editable inline.
 * - Subir archivos (multipart vía /api/upload-imagen) o agregar por URL.
 * - Reordenar, quitar y guardar (un solo PATCH con la lista final).
 * - Valida el tamaño de MeLi (>=500×250) y permite AGRANDAR en el navegador
 *   (Canvas) las fotos chicas, sin salir ni re-subir manualmente.
 */
export function PicturesEditor({ pubId, pictures, onSaved }: Props) {
    const [urls, setUrls] = useState<string[]>(pictures);
    const [newUrl, setNewUrl] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [dirty, setDirty] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [sizes, setSizes] = useState<Record<string, ImageSize | null>>({});
    const [upscaling, setUpscaling] = useState<Record<string, boolean>>({});
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Medir dimensiones de cada foto (para el badge de tamaño).
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const map: Record<string, ImageSize | null> = {};
            for (const u of urls) {
                const s = await measureImage(u);
                if (cancelled) return;
                map[u] = s;
            }
            setSizes(map);
        })();
        return () => { cancelled = true; };
    }, [urls]);

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

    async function uploadBlob(blob: Blob, name = 'imagen.jpg'): Promise<string> {
        const form = new FormData();
        form.append('file', blob, name);
        const res = await fetch('/api/upload-imagen', { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Error al subir imagen');
        return data.url;
    }

    async function handleFiles(files: FileList | null) {
        if (!files || files.length === 0) return;
        setUploading(true);
        setError('');
        try {
            for (const file of Array.from(files)) {
                const url = await uploadBlob(file, file.name);
                setUrls(prev => (prev.includes(url) ? prev : [...prev, url]));
            }
            setDirty(true);
        } catch (e: any) {
            setError(e?.message || 'Error al subir archivo');
        } finally {
            setUploading(false);
        }
    }

    async function agrandar(url: string) {
        setUpscaling(prev => ({ ...prev, [url]: true }));
        setError('');
        try {
            const blob = await upscaleImage(url);
            if (!blob) { setError('No se pudo procesar la imagen (o ya cumple el tamaño).'); return; }
            const newUrl = await uploadBlob(blob);
            setUrls(prev => prev.map(u => (u === url ? newUrl : u)));
            setDirty(true);
        } catch (e: any) {
            setError(e?.message || 'Error al agrandar');
        } finally {
            setUpscaling(prev => ({ ...prev, [url]: false }));
        }
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
                {urls.map((u, i) => {
                    const size = sizes[u];
                    const ok = size != null && meetsMeliSize(size);
                    return (
                        <div key={i} className="relative aspect-square rounded-lg border border-[var(--border)] overflow-hidden group">
                            <img src={u} alt="" className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.opacity = '0.2')} />
                            <span className="absolute top-1 left-1 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">#{i + 1}</span>
                            {size != null && (
                                <span className={`absolute top-1 right-1 text-[9px] font-bold px-1 py-0.5 rounded ${ok ? 'bg-[var(--ok)]/90 text-white' : 'bg-[var(--err)]/90 text-white'}`}>
                                    {ok ? `✓ ${size.w}×${size.h}` : `✗ ${size.w}×${size.h}`}
                                </span>
                            )}
                            {size != null && !ok && (
                                <button
                                    onClick={() => agrandar(u)}
                                    disabled={upscaling[u]}
                                    className="absolute bottom-8 right-1 px-1.5 py-0.5 text-[10px] font-bold bg-[var(--accent)] text-white rounded disabled:opacity-50"
                                    title="Agrandar a >=500px (en el navegador)"
                                >
                                    {upscaling[u] ? <Loader2 className="w-3 h-3 animate-spin inline" /> : <Wand2 className="w-3 h-3 inline mr-0.5" />}
                                    Agrandar
                                </button>
                            )}
                            <div className="absolute bottom-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 bg-black/60 text-white rounded disabled:opacity-30" title="Subir"><ArrowUp className="w-3 h-3" /></button>
                                <button onClick={() => move(i, 1)} disabled={i === urls.length - 1} className="p-1 bg-black/60 text-white rounded disabled:opacity-30" title="Bajar"><ArrowDown className="w-3 h-3" /></button>
                                <button onClick={() => remove(i)} className="p-1 bg-[var(--err)]/80 text-white rounded" title="Quitar"><Trash2 className="w-3 h-3" /></button>
                            </div>
                        </div>
                    );
                })}
            </div>
            {urls.length === 0 && <p className="text-xs text-[var(--text-faint)]">Sin fotos.</p>}

            <div className="flex flex-wrap gap-2">
                <input type="file" accept="image/*" multiple ref={fileInputRef} className="hidden" onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="h-10 px-3 text-sm font-bold bg-[var(--surface-2)] border border-[var(--border)] rounded-lg flex items-center gap-1 disabled:opacity-50">
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {uploading ? 'Subiendo…' : 'Subir archivo'}
                </button>
                <input type="url" value={newUrl} onChange={(e) => { setNewUrl(e.target.value); setError(''); }} onKeyDown={(e) => e.key === 'Enter' && addUrl()} placeholder="https://... URL de imagen" className="flex-1 h-10 min-w-[160px] px-3 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)]" />
                <button onClick={addUrl} className="h-10 px-3 text-sm font-bold bg-[var(--surface-2)] border border-[var(--border)] rounded-lg flex items-center gap-1"><Plus className="w-4 h-4" /> URL</button>
            </div>

            <div className="flex items-center gap-3">
                <button onClick={save} disabled={saving || !dirty} className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-[var(--accent)] rounded-lg disabled:opacity-40">
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {saving ? 'Guardando…' : 'Guardar fotos'}
                </button>
                {dirty && <span className="text-[10px] text-[var(--accent)] font-bold">● cambios sin guardar</span>}
            </div>

            {error && <p className="text-[10px] text-[var(--err)] break-words">{error}</p>}
        </div>
    );
}
