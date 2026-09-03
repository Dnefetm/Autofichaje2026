"use client";

import { useState, useEffect } from 'react';
import { ArrowLeft, Save, Plus, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface Profile {
    id: string;
    name: string;
    scope: 'title' | 'description';
    system_prompt: string;
    temperature: number;
    max_chars: number;
    is_active: boolean;
    is_default: boolean;
}

const SCOPE_LABEL: Record<string, string> = {
    title: 'Título',
    description: 'Descripción',
};

export default function PromptProfilesPage() {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState<string | null>(null);

    // Formulario de nuevo/editar
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formScope, setFormScope] = useState<'title' | 'description'>('title');
    const [formName, setFormName] = useState('');
    const [formPrompt, setFormPrompt] = useState('');
    const [formTemp, setFormTemp] = useState('0.3');
    const [formMax, setFormMax] = useState('60');

    async function load() {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/prompt-profiles');
            const data = await res.json();
            if (data.ok) setProfiles(data.profiles || []);
            else setError(data.error || 'Error al cargar');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, []);

    function startNew(scope: 'title' | 'description') {
        setEditingId(null);
        setFormScope(scope);
        setFormName('');
        setFormPrompt('');
        setFormTemp('0.3');
        setFormMax(scope === 'title' ? '60' : '2000');
    }

    function startEdit(p: Profile) {
        setEditingId(p.id);
        setFormScope(p.scope);
        setFormName(p.name);
        setFormPrompt(p.system_prompt);
        setFormTemp(String(p.temperature));
        setFormMax(String(p.max_chars));
    }

    async function save() {
        if (!formName.trim() || !formPrompt.trim()) {
            setError('Nombre y prompt son obligatorios');
            return;
        }
        setSaving(formName);
        setError(null);
        try {
            const res = await fetch('/api/prompt-profiles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scope: formScope,
                    name: formName.trim(),
                    system_prompt: formPrompt,
                    temperature: Number(formTemp),
                    max_chars: Number(formMax),
                }),
            });
            const data = await res.json();
            if (data.ok) {
                setEditingId(null);
                await load();
            } else {
                setError(data.error || 'Error al guardar');
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSaving(null);
        }
    }

    const byScope = (scope: string) => profiles.filter(p => p.scope === scope);

    return (
        <div className="space-y-6 animate-in fade-in duration-500 max-w-3xl">
            <div className="flex items-center justify-between">
                <Link href="/" className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors font-medium">
                    <ArrowLeft className="w-4 h-4" /> Volver
                </Link>
                <button onClick={load} className="p-2 text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors" title="Refrescar">
                    <RefreshCw className="w-5 h-5" />
                </button>
            </div>

            <div>
                <h1 className="text-xl font-bold text-[var(--text)]">Perfiles de prompts de IA</h1>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                    Edita el prompt de <strong>Título</strong> y de <strong>Descripción</strong> por separado.
                    El bloque anti-alucinación se antepone siempre y no es editable.
                </p>
            </div>

            {error && (
                <div className="p-3 rounded-lg bg-[var(--err)]/10 border border-[var(--err)]/30 text-xs text-[var(--err)] flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" /> {error}
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <RefreshCw className="w-8 h-8 animate-spin text-[var(--accent)]" />
                </div>
            ) : (
                ['title', 'description'].map(scope => (
                    <div key={scope} className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] shadow-sm overflow-hidden">
                        <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between">
                            <h2 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">{SCOPE_LABEL[scope]}</h2>
                            <button onClick={() => startNew(scope as any)} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-[var(--accent)] bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded-[var(--radius-sm)] hover:bg-[var(--accent)]/20 transition-colors">
                                <Plus className="w-3.5 h-3.5" /> Nuevo perfil
                            </button>
                        </div>

                        <div className="divide-y divide-[var(--border)]">
                            {byScope(scope).length === 0 && (
                                <div className="p-6 text-center text-[var(--text-faint)] text-sm">Sin perfiles.</div>
                            )}
                            {byScope(scope).map(p => (
                                <div key={p.id} className="px-5 py-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="text-sm font-semibold text-[var(--text)] truncate">{p.name}</span>
                                            {p.is_default && <span className="text-[9px] uppercase font-bold text-[var(--ok)] bg-[var(--ok)]/10 border border-[var(--ok)]/30 px-1.5 py-0.5 rounded-full">Default</span>}
                                            {!p.is_active && <span className="text-[9px] uppercase font-bold text-[var(--text-faint)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded-full">Inactivo</span>}
                                        </div>
                                        <button onClick={() => startEdit(p)} className="text-xs font-bold text-[var(--accent)] hover:underline shrink-0">Editar</button>
                                    </div>
                                    <pre className="mt-2 text-[11px] text-[var(--text-muted)] whitespace-pre-wrap bg-[var(--bg)] rounded p-2 max-h-32 overflow-auto">{p.system_prompt}</pre>
                                    <p className="mt-1 text-[10px] text-[var(--text-faint)]">temp {p.temperature} · máx {p.max_chars} chars</p>
                                </div>
                            ))}
                        </div>

                        {/* Formulario de edición / nuevo */}
                        {editingId === null && formScope === scope && (
                            <div className="px-5 py-4 border-t border-[var(--border)] bg-[var(--bg)] space-y-3">
                                <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">{editingId === null && !byScope(scope).some(p => p.id === editingId) ? 'Nuevo perfil' : 'Editar perfil'}</p>
                                <input
                                    value={formName}
                                    onChange={e => setFormName(e.target.value)}
                                    placeholder="Nombre del perfil"
                                    className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-yellow-400"
                                />
                                <textarea
                                    value={formPrompt}
                                    onChange={e => setFormPrompt(e.target.value)}
                                    rows={7}
                                    placeholder="Prompt del sistema (fórmula/estilo)"
                                    className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-yellow-400 font-mono"
                                />
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-[10px] font-bold text-[var(--text-faint)] uppercase block mb-1">Temperatura</label>
                                        <input type="number" step="0.1" min="0" max="1" value={formTemp} onChange={e => setFormTemp(e.target.value)} className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-yellow-400" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-[var(--text-faint)] uppercase block mb-1">Máx caracteres</label>
                                        <input type="number" value={formMax} onChange={e => setFormMax(e.target.value)} className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-yellow-400" />
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={save} disabled={saving !== null} className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[var(--accent)] rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity">
                                        {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Guardar
                                    </button>
                                    <button onClick={() => setEditingId('__cancel__')} className="px-4 py-2 text-xs font-bold text-[var(--text-muted)] border border-[var(--border)] rounded-lg hover:bg-[var(--surface-2)] transition-colors">Cancelar</button>
                                </div>
                            </div>
                        )}
                    </div>
                ))
            )}

            <p className="text-xs text-[var(--text-faint)]">
                Nota: la tabla prompt_profiles se crea con la migración v125. Si no ves perfiles, verifica que la migración esté aplicada.
            </p>
        </div>
    );
}
