"use client";

import { useState, useEffect } from 'react';
import { ArrowLeft, Save, Plus, RefreshCw, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';

interface Profile {
    id: string;
    name: string;
    scope: 'title' | 'description';
    system_prompt: string;
    instructions?: string | null;
    tone?: string | null;
    length_pref?: string | null;
    include_measures?: boolean;
    include_brand?: boolean;
    include_model?: boolean;
    include_material?: boolean;
    language?: string;
    temperature: number;
    max_chars: number;
    is_active: boolean;
    is_default: boolean;
}

const SCOPE_LABEL: Record<string, string> = { title: 'Título', description: 'Descripción' };
const TONES = ['formal', 'cercano', 'técnico'];
const LENGTHS = ['corto', 'medio', 'largo'];

// Vista previa del prompt (espejo del compilador del servidor; solo informativa).
function buildPreviewPrompt(scope: 'title' | 'description', f: {
    instructions: string; tone: string; length_pref: string;
    include_measures: boolean; include_brand: boolean; include_model: boolean; include_material: boolean; language: string;
}): string {
    const lines: string[] = [];
    if (f.instructions.trim()) lines.push(`Instrucciones de estilo:\n${f.instructions.trim()}`);
    if (f.tone) lines.push(`- Tono: ${f.tone}.`);
    if (f.length_pref) lines.push(`- Extensión: ${f.length_pref}.`);
    const incl: string[] = [];
    if (f.include_measures) incl.push('medidas');
    if (f.include_brand) incl.push('marca');
    if (f.include_model) incl.push('modelo');
    if (f.include_material) incl.push('material');
    if (incl.length) lines.push(`- Incluye: ${incl.join(', ')}.`);
    if (f.language) lines.push(`- Idioma: ${f.language}.`);

    if (scope === 'title') {
        return `Eres un redactor experto en títulos para MercadoLibre México.\n${lines.join('\n')}\nResponde SOLO JSON: { "title": "..." }`;
    }
    return `Eres un redactor experto en descripciones de venta para MercadoLibre México.\n${lines.join('\n')}\nUsa bullets "•" y NO inventes datos que no estén en la entrada.\nResponde SOLO JSON: { "description": "..." }`;
}

export default function PromptProfilesPage() {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [formScope, setFormScope] = useState<'title' | 'description'>('title');
    const [formName, setFormName] = useState('');
    const [formInstructions, setFormInstructions] = useState('');
    const [formTone, setFormTone] = useState('');
    const [formLength, setFormLength] = useState('');
    const [formIncludeMeasures, setFormIncludeMeasures] = useState(true);
    const [formIncludeBrand, setFormIncludeBrand] = useState(true);
    const [formIncludeModel, setFormIncludeModel] = useState(false);
    const [formIncludeMaterial, setFormIncludeMaterial] = useState(true);
    const [formLanguage, setFormLanguage] = useState('es-MX');
    const [formTemp, setFormTemp] = useState('0.3');
    const [formMax, setFormMax] = useState('60');
    const [expertMode, setExpertMode] = useState(false);
    const [formExpertPrompt, setFormExpertPrompt] = useState('');

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
        setFormInstructions('');
        setFormTone('');
        setFormLength('');
        setFormIncludeMeasures(true);
        setFormIncludeBrand(true);
        setFormIncludeModel(false);
        setFormIncludeMaterial(true);
        setFormLanguage('es-MX');
        setFormTemp('0.3');
        setFormMax(scope === 'title' ? '60' : '2000');
        setExpertMode(false);
        setFormExpertPrompt('');
    }

    function startEdit(p: Profile) {
        setEditingId(p.id);
        setFormScope(p.scope);
        setFormName(p.name);
        setFormInstructions(p.instructions || '');
        setFormTone(p.tone || '');
        setFormLength(p.length_pref || '');
        setFormIncludeMeasures(p.include_measures !== false);
        setFormIncludeBrand(p.include_brand !== false);
        setFormIncludeModel(p.include_model === true);
        setFormIncludeMaterial(p.include_material !== false);
        setFormLanguage(p.language || 'es-MX');
        setFormTemp(String(p.temperature));
        setFormMax(String(p.max_chars));
        setExpertMode(false);
        setFormExpertPrompt('');
    }

    async function save() {
        if (!formName.trim() || (!formInstructions.trim() && !formExpertPrompt.trim())) {
            setError('Nombre e instrucción (o prompt experto) son obligatorios');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const body: any = {
                scope: formScope,
                name: formName.trim(),
                temperature: Number(formTemp),
                max_chars: Number(formMax),
                tone: formTone || null,
                length_pref: formLength || null,
                include_measures: formIncludeMeasures,
                include_brand: formIncludeBrand,
                include_model: formIncludeModel,
                include_material: formIncludeMaterial,
                language: formLanguage || 'es-MX',
            };
            if (expertMode && formExpertPrompt.trim()) {
                body.system_prompt = formExpertPrompt.trim();
                body.instructions = null;
            } else {
                body.instructions = formInstructions.trim();
                body.system_prompt = '';
            }
            const res = await fetch('/api/prompt-profiles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
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
            setSaving(false);
        }
    }

    const byScope = (scope: string) => profiles.filter(p => p.scope === scope);
    const previewPrompt = buildPreviewPrompt(formScope, {
        instructions: formInstructions, tone: formTone, length_pref: formLength,
        include_measures: formIncludeMeasures, include_brand: formIncludeBrand,
        include_model: formIncludeModel, include_material: formIncludeMaterial, language: formLanguage,
    });

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
                <h1 className="text-xl font-bold text-[var(--text)]">Voz de marca (IA de publicación)</h1>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                    Escribe en lenguaje natural cómo debe redactar tu IA. El bloque anti-alucinación se antepone siempre y no es editable.
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
                            {byScope(scope).length === 0 && <div className="p-6 text-center text-[var(--text-faint)] text-sm">Sin perfiles.</div>}
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
                                    {p.instructions && <p className="mt-2 text-xs text-[var(--text-muted)] italic">"{p.instructions.slice(0, 180)}{p.instructions.length > 180 ? '…' : ''}"</p>}
                                    <p className="mt-1 text-[10px] text-[var(--text-faint)]">temp {p.temperature} · máx {p.max_chars} chars · {p.tone || 'sin tono'} · {p.language}</p>
                                </div>
                            ))}
                        </div>

                        {editingId === null && formScope === scope && (
                            <div className="px-5 py-4 border-t border-[var(--border)] bg-[var(--bg)] space-y-3">
                                <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Nuevo perfil de {SCOPE_LABEL[scope]}</p>
                                <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Nombre del perfil (ej. Herramientas MX)" className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
                                <textarea value={formInstructions} onChange={e => setFormInstructions(e.target.value)} rows={3} placeholder="Instrucción en lenguaje natural (ej. Títulos cortos y técnicos, incluye medida y material, sin adjetivos comerciales)" className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-[10px] font-bold text-[var(--text-faint)] uppercase block mb-1">Tono</label>
                                        <select value={formTone} onChange={e => setFormTone(e.target.value)} className="w-full px-2 py-1.5 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)]">
                                            <option value="">Sin tono</option>
                                            {TONES.map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-[var(--text-faint)] uppercase block mb-1">Extensión</label>
                                        <select value={formLength} onChange={e => setFormLength(e.target.value)} className="w-full px-2 py-1.5 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)]">
                                            <option value="">Sin preferencia</option>
                                            {LENGTHS.map(l => <option key={l} value={l}>{l}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-3 text-xs">
                                    {[
                                        ['include_measures', formIncludeMeasures, setFormIncludeMeasures, 'Medidas'],
                                        ['include_brand', formIncludeBrand, setFormIncludeBrand, 'Marca'],
                                        ['include_model', formIncludeModel, setFormIncludeModel, 'Modelo'],
                                        ['include_material', formIncludeMaterial, setFormIncludeMaterial, 'Material'],
                                    ].map(([key, val, set, label]: any) => (
                                        <label key={key} className="flex items-center gap-1.5 cursor-pointer">
                                            <input type="checkbox" checked={val} onChange={e => set(e.target.checked)} className="w-3.5 h-3.5 rounded text-[var(--accent)]" />
                                            <span className="text-[var(--text-muted)]">{label}</span>
                                        </label>
                                    ))}
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    <div>
                                        <label className="text-[10px] font-bold text-[var(--text-faint)] uppercase block mb-1">Idioma</label>
                                        <input value={formLanguage} onChange={e => setFormLanguage(e.target.value)} className="w-full px-2 py-1.5 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)]" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-[var(--text-faint)] uppercase block mb-1">Temperatura</label>
                                        <input type="number" step="0.1" min="0" max="1" value={formTemp} onChange={e => setFormTemp(e.target.value)} className="w-full px-2 py-1.5 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)]" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-[var(--text-faint)] uppercase block mb-1">Máx chars</label>
                                        <input type="number" value={formMax} onChange={e => setFormMax(e.target.value)} className="w-full px-2 py-1.5 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)]" />
                                    </div>
                                </div>

                                <div>
                                    <button type="button" onClick={() => setExpertMode(v => !v)} className="inline-flex items-center gap-1 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text)]">
                                        {expertMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} Modo experto (prompt crudo)
                                    </button>
                                    {expertMode && (
                                        <textarea value={formExpertPrompt} onChange={e => setFormExpertPrompt(e.target.value)} rows={6} placeholder="Prompt completo (reemplaza la capa simple)" className="mt-1.5 w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] font-mono" />
                                    )}
                                </div>

                                <div className="p-2.5 bg-[var(--surface-2)] rounded border border-[var(--border)]">
                                    <p className="text-[10px] font-bold uppercase text-[var(--text-faint)] mb-1">Prompt que se enviará (vista previa)</p>
                                    <pre className="text-[10px] text-[var(--text-muted)] whitespace-pre-wrap">{previewPrompt}</pre>
                                </div>

                                <div className="flex gap-2">
                                    <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-[var(--accent-ink)] bg-[var(--accent)] rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity">
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
                El bloque anti-alucinación (no inventar datos, usar el id exacto de cada valor) se antepone siempre en código y no se muestra aquí.
            </p>
        </div>
    );
}
