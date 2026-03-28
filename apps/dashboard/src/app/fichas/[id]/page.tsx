"use client";

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    ArrowLeft, Loader2, AlertCircle, FileText, Link2,
    CheckCircle2, ExternalLink, Trash2, Edit2, Save, X, Tag, List,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Estado = 'borrador' | 'revision' | 'publicada';

interface FichaDetalle {
    id: string;
    estado: string;
    // Campos base
    nombre_producto: string;
    descripcion?: string;
    descripcion_larga?: string;
    fabricante?: string;
    especificaciones?: string;
    ingredientes?: string;
    uso_recomendado?: string;
    precauciones?: string;
    // Campos JSONB
    bullet_points?: string[];
    palabras_clave?: string[];
    atributos_dinamicos?: Record<string, any>;
    atributos_categoria?: Record<string, any>;
    atributos_extras?: Record<string, any>;
    ficha_tecnica_data?: Record<string, any>;
    // Relaciones
    articulo_id?: string;
    articulos?: {
        articulo_id: string; nombre: string; marca: string;
        modelo?: string; variante?: string; codigo_universal?: string;
    } | null;
    ficha_extracciones?: Array<{
        id: string; extraccion_cruda: any; aplicada_a_ficha: boolean; created_at: string;
    }>;
    created_at: string;
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function EstadoBadge({ estado }: { estado: string }) {
    const map: Record<string, string> = {
        borrador:  'bg-slate-100 text-slate-600',
        revision:  'bg-amber-100 text-amber-700',
        publicada: 'bg-emerald-100 text-emerald-700',
    };
    return (
        <span className={`text-xs font-bold px-3 py-1 rounded-full capitalize ${map[estado] || 'bg-slate-100 text-slate-500'}`}>
            {estado}
        </span>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{children}</p>;
}

function FieldRow({ label, value }: { label: string; value?: string | null }) {
    if (!value) return null;
    return (
        <div>
            <SectionLabel>{label}</SectionLabel>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{value}</p>
        </div>
    );
}

function JsonbKV({ label, data }: { label: string; data?: Record<string, any> | null }) {
    if (!data || Object.keys(data).length === 0) return null;
    return (
        <div>
            <SectionLabel>{label}</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Object.entries(data).map(([k, v]) => (
                    <div key={k} className="flex gap-2 text-xs bg-slate-50 rounded-lg px-3 py-2">
                        <span className="font-mono text-slate-400 shrink-0">{k}:</span>
                        <span className="text-slate-700 break-words">{String(v ?? '')}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Campo de edición simple ──────────────────────────────────────────────────

interface EditFieldProps {
    label: string;
    value?: string;
    onChange: (v: string) => void;
    type?: 'text' | 'textarea';
    mono?: boolean;
}
function EditField({ label, value, onChange, type = 'text', mono = false }: EditFieldProps) {
    const cls = `w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-1 focus:ring-indigo-500 outline-none${mono ? ' font-mono' : ''}`;
    return (
        <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</label>
            {type === 'textarea'
                ? <textarea className={`${cls} h-24 resize-none`} value={value ?? ''} onChange={e => onChange(e.target.value)} />
                : <input type="text" className={cls} value={value ?? ''} onChange={e => onChange(e.target.value)} />
            }
        </div>
    );
}

// ─── Página principal ─────────────────────────────────────────────────────────

const ESTADOS: Estado[] = ['borrador', 'revision', 'publicada'];

export default function FichaDetallePage() {
    const { id }  = useParams<{ id: string }>();
    const router  = useRouter();

    const [ficha, setFicha]       = useState<FichaDetalle | null>(null);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState('');
    const [saving, setSaving]     = useState(false);
    const [savedOk, setSavedOk]   = useState(false);
    const [deleting, setDeleting] = useState(false);

    // Modo edición
    const [editMode, setEditMode] = useState(false);
    const [draft, setDraft]       = useState<Partial<FichaDetalle>>({});
    const [patchSaving, setPatchSaving] = useState(false);
    const [patchError, setPatchError]   = useState('');

    useEffect(() => {
        if (!id) return;
        (async () => {
            setLoading(true);
            const { data, error } = await supabase
                .from('fichas_tecnicas')
                .select(`
                    id, estado, created_at,
                    nombre_producto, descripcion, descripcion_larga,
                    fabricante, especificaciones, ingredientes,
                    uso_recomendado, precauciones,
                    bullet_points, palabras_clave,
                    atributos_dinamicos, atributos_categoria, atributos_extras,
                    ficha_tecnica_data,
                    articulo_id,
                    articulos ( articulo_id, nombre, marca, modelo, variante, codigo_universal ),
                    ficha_extracciones ( id, extraccion_cruda, aplicada_a_ficha, created_at )
                `)
                .eq('id', id)
                .single();
            if (error) setError(error.message);
            else setFicha(data as unknown as FichaDetalle);
            setLoading(false);
        })();
    }, [id]);

    // ── Cambiar estado ────────────────────────────────────────────────────────

    async function cambiarEstado(nuevoEstado: Estado) {
        if (!ficha) return;
        setSaving(true);
        const { error } = await supabase
            .from('fichas_tecnicas')
            .update({ estado: nuevoEstado })
            .eq('id', ficha.id);
        if (!error) {
            setFicha(p => p ? { ...p, estado: nuevoEstado } : p);
            setSavedOk(true);
            setTimeout(() => setSavedOk(false), 2000);
        }
        setSaving(false);
    }

    // ── Eliminar ──────────────────────────────────────────────────────────────

    async function eliminarFicha() {
        if (!ficha) return;
        if (!window.confirm(`¿Eliminar la ficha "${ficha.nombre_producto || 'sin nombre'}"?\nEsta acción no se puede deshacer.`)) return;
        setDeleting(true);
        try {
            const res = await fetch(`/api/fichas/${ficha.id}`, { method: 'DELETE' });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) { setError(body?.error || 'Error al eliminar.'); setDeleting(false); return; }
            router.push('/fichas');
        } catch (err: any) {
            setError(err?.message || 'Error de red.'); setDeleting(false);
        }
    }

    // ── Edición ───────────────────────────────────────────────────────────────

    function startEdit() {
        if (!ficha) return;
        setDraft({
            nombre_producto:  ficha.nombre_producto,
            descripcion:      ficha.descripcion,
            descripcion_larga: ficha.descripcion_larga,
            fabricante:       ficha.fabricante,
            especificaciones: ficha.especificaciones,
            ingredientes:     ficha.ingredientes,
            uso_recomendado:  ficha.uso_recomendado,
            precauciones:     ficha.precauciones,
            bullet_points:    ficha.bullet_points ? [...ficha.bullet_points] : [],
            palabras_clave:   ficha.palabras_clave ? [...ficha.palabras_clave] : [],
            atributos_dinamicos: ficha.atributos_dinamicos ? { ...ficha.atributos_dinamicos } : {},
            atributos_categoria: ficha.atributos_categoria ? { ...ficha.atributos_categoria } : {},
            atributos_extras:    ficha.atributos_extras    ? { ...ficha.atributos_extras }    : {},
        });
        setPatchError('');
        setEditMode(true);
    }

    function cancelEdit() { setEditMode(false); setDraft({}); setPatchError(''); }

    async function saveEdit() {
        if (!ficha) return;
        setPatchSaving(true); setPatchError('');
        try {
            const res = await fetch(`/api/fichas/${ficha.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(draft),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) { setPatchError(body?.error || 'Error al guardar.'); setPatchSaving(false); return; }
            setFicha(p => p ? { ...p, ...body.ficha } : p);
            setEditMode(false); setDraft({});
        } catch (err: any) {
            setPatchError(err?.message || 'Error de red.');
        }
        setPatchSaving(false);
    }

    // ── Render guards ─────────────────────────────────────────────────────────

    if (loading) return (
        <div className="flex items-center justify-center h-64 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando ficha…
        </div>
    );
    if (error) return (
        <div className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700">
            <AlertCircle className="w-5 h-5 shrink-0" /><p>{error}</p>
        </div>
    );
    if (!ficha) return null;

    const art = ficha.articulos;
    const hasBullets  = (ficha.bullet_points ?? []).length > 0;
    const hasKeywords = (ficha.palabras_clave ?? []).length > 0;
    const hasAtribDin = ficha.atributos_dinamicos && Object.keys(ficha.atributos_dinamicos).length > 0;
    const hasAtribCat = ficha.atributos_categoria && Object.keys(ficha.atributos_categoria).length > 0;
    const hasAtribExt = ficha.atributos_extras    && Object.keys(ficha.atributos_extras).length > 0;

    // ── JSX ───────────────────────────────────────────────────────────────────

    return (
        <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-500">

            {/* Header */}
            <div className="flex items-center gap-4">
                <button type="button" onClick={() => router.back()}
                    className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-400">
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex-1">
                    <h2 className="text-2xl font-bold tracking-tight">{ficha.nombre_producto || 'Ficha sin nombre'}</h2>
                    <p className="text-slate-400 text-xs font-mono mt-0.5">{ficha.id}</p>
                </div>
                <EstadoBadge estado={ficha.estado} />
                {!editMode && (
                    <button type="button" onClick={startEdit}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-xl hover:bg-indigo-100 transition-colors">
                        <Edit2 className="w-4 h-4" /> Editar
                    </button>
                )}
            </div>

            {/* Banner modo edición */}
            {editMode && (
                <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-2xl px-5 py-3">
                    <p className="text-sm font-semibold text-indigo-700">Modo edición — los cambios no se aplican hasta guardar</p>
                    <div className="flex gap-2">
                        <button type="button" onClick={cancelEdit}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
                            <X className="w-4 h-4" /> Cancelar
                        </button>
                        <button type="button" onClick={saveEdit} disabled={patchSaving}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60">
                            {patchSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Guardar cambios
                        </button>
                    </div>
                </div>
            )}
            {patchError && (
                <div className="flex gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{patchError}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* ── Columna principal ── */}
                <div className="lg:col-span-2 space-y-5">

                    {/* Datos base */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
                        <h3 className="text-base font-bold flex items-center gap-2">
                            <FileText className="w-4 h-4 text-indigo-500" /> Datos de la ficha
                        </h3>

                        {editMode ? (
                            <div className="space-y-4">
                                <EditField label="Nombre del producto" value={draft.nombre_producto} onChange={v => setDraft(d => ({ ...d, nombre_producto: v }))} />
                                <EditField label="Fabricante" value={draft.fabricante} onChange={v => setDraft(d => ({ ...d, fabricante: v }))} />
                                <EditField label="Descripción técnica (corta)" value={draft.descripcion} onChange={v => setDraft(d => ({ ...d, descripcion: v }))} type="textarea" />
                                <EditField label="Descripción extendida" value={draft.descripcion_larga} onChange={v => setDraft(d => ({ ...d, descripcion_larga: v }))} type="textarea" />
                                <EditField label="Especificaciones" value={draft.especificaciones} onChange={v => setDraft(d => ({ ...d, especificaciones: v }))} type="textarea" />
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <FieldRow label="Fabricante" value={ficha.fabricante} />
                                <FieldRow label="Descripción técnica" value={ficha.descripcion} />
                                <FieldRow label="Descripción extendida" value={ficha.descripcion_larga} />
                                <FieldRow label="Especificaciones" value={ficha.especificaciones} />
                                <div>
                                    <SectionLabel>Creada</SectionLabel>
                                    <p className="text-sm text-slate-600">{new Date(ficha.created_at).toLocaleString('es-MX')}</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Uso y Seguridad */}
                    {(ficha.uso_recomendado || ficha.precauciones || ficha.ingredientes || editMode) && (
                        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
                            <h3 className="text-base font-bold">Uso y Seguridad</h3>
                            {editMode ? (
                                <div className="space-y-4">
                                    <EditField label="Uso recomendado" value={draft.uso_recomendado} onChange={v => setDraft(d => ({ ...d, uso_recomendado: v }))} type="textarea" />
                                    <EditField label="Precauciones" value={draft.precauciones} onChange={v => setDraft(d => ({ ...d, precauciones: v }))} type="textarea" />
                                    <EditField label="Ingredientes / Composición" value={draft.ingredientes} onChange={v => setDraft(d => ({ ...d, ingredientes: v }))} type="textarea" />
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <FieldRow label="Uso recomendado" value={ficha.uso_recomendado} />
                                    <FieldRow label="Precauciones" value={ficha.precauciones} />
                                    <FieldRow label="Ingredientes / Composición" value={ficha.ingredientes} />
                                </div>
                            )}
                        </div>
                    )}

                    {/* Bullet points */}
                    {(hasBullets || editMode) && (
                        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3 shadow-sm">
                            <h3 className="text-base font-bold flex items-center gap-2">
                                <List className="w-4 h-4 text-indigo-500" /> Puntos clave
                            </h3>
                            {editMode ? (
                                <div className="space-y-2">
                                    {(draft.bullet_points ?? []).map((bp, i) => (
                                        <div key={i} className="flex gap-2">
                                            <input value={bp}
                                                onChange={e => {
                                                    const arr = [...(draft.bullet_points ?? [])];
                                                    arr[i] = e.target.value;
                                                    setDraft(d => ({ ...d, bullet_points: arr }));
                                                }}
                                                className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-indigo-500 outline-none" />
                                            <button type="button"
                                                onClick={() => setDraft(d => ({ ...d, bullet_points: (d.bullet_points ?? []).filter((_, j) => j !== i) }))}
                                                className="text-slate-300 hover:text-rose-500"><X className="w-4 h-4" /></button>
                                        </div>
                                    ))}
                                    <button type="button"
                                        onClick={() => setDraft(d => ({ ...d, bullet_points: [...(d.bullet_points ?? []), ''] }))}
                                        className="text-xs text-indigo-500 hover:text-indigo-700">+ Agregar punto</button>
                                </div>
                            ) : (
                                <ul className="space-y-1.5">
                                    {(ficha.bullet_points ?? []).map((bp, i) => (
                                        <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                                            <span className="text-indigo-400 mt-0.5 shrink-0">▸</span>{bp}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}

                    {/* Palabras clave */}
                    {(hasKeywords || editMode) && (
                        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3 shadow-sm">
                            <h3 className="text-base font-bold flex items-center gap-2">
                                <Tag className="w-4 h-4 text-indigo-500" /> Palabras clave
                            </h3>
                            {editMode ? (
                                <div className="space-y-2">
                                    <div className="flex flex-wrap gap-2">
                                        {(draft.palabras_clave ?? []).map((kw, i) => (
                                            <span key={i} className="flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs px-2 py-1 rounded-full">
                                                {kw}
                                                <button type="button"
                                                    onClick={() => setDraft(d => ({ ...d, palabras_clave: (d.palabras_clave ?? []).filter((_, j) => j !== i) }))}
                                                    className="hover:text-rose-500"><X className="w-2.5 h-2.5" /></button>
                                            </span>
                                        ))}
                                    </div>
                                    <input placeholder="Agregar keyword y Enter"
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                                setDraft(d => ({ ...d, palabras_clave: [...(d.palabras_clave ?? []), e.currentTarget.value.trim()] }));
                                                e.currentTarget.value = '';
                                            }
                                        }}
                                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-indigo-500 outline-none" />
                                </div>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    {(ficha.palabras_clave ?? []).map((kw, i) => (
                                        <span key={i} className="bg-indigo-50 text-indigo-700 text-xs font-semibold px-3 py-1 rounded-full">{kw}</span>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Atributos técnicos / categoría / extras */}
                    {(hasAtribDin || hasAtribCat || hasAtribExt) && !editMode && (
                        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
                            <h3 className="text-base font-bold">Atributos técnicos</h3>
                            <JsonbKV label="Por categoría" data={ficha.atributos_categoria} />
                            <JsonbKV label="Atributos detectados (IA)" data={ficha.atributos_dinamicos} />
                            <JsonbKV label="Atributos extras" data={ficha.atributos_extras} />
                        </div>
                    )}

                    {/* Artículo vinculado */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
                        <h3 className="text-base font-bold flex items-center gap-2">
                            <Link2 className="w-4 h-4 text-indigo-500" /> Artículo del catálogo
                        </h3>
                        {art ? (
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div><SectionLabel>SKU</SectionLabel><p className="font-mono text-slate-700">{art.articulo_id}</p></div>
                                <div><SectionLabel>Nombre</SectionLabel><p className="text-slate-700">{art.nombre}</p></div>
                                <div><SectionLabel>Marca</SectionLabel><p className="text-slate-700">{art.marca}</p></div>
                                {art.modelo && <div><SectionLabel>Modelo</SectionLabel><p className="text-slate-700">{art.modelo}</p></div>}
                                {art.variante && <div><SectionLabel>Variante</SectionLabel><p className="text-slate-700">{art.variante}</p></div>}
                                {art.codigo_universal && <div><SectionLabel>EAN</SectionLabel><p className="font-mono text-slate-700">{art.codigo_universal}</p></div>}
                                <div className="col-span-2">
                                    <Link href={`/catalog?q=${art.articulo_id}`} target="_blank"
                                        className="inline-flex items-center gap-1 text-indigo-500 hover:text-indigo-700 text-xs font-semibold">
                                        Ver en catálogo <ExternalLink className="w-3 h-3" />
                                    </Link>
                                </div>
                            </div>
                        ) : (
                            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
                                <p className="font-semibold">Sin artículo vinculado</p>
                                <p className="text-xs mt-0.5">Esta ficha no está asociada a ningún artículo del catálogo.</p>
                                <Link href="/autoficha" className="inline-block mt-2 text-xs text-amber-600 underline">Ir a Crear con IA para vincular</Link>
                            </div>
                        )}
                    </div>

                    {/* Historial de extracciones */}
                    {ficha.ficha_extracciones && ficha.ficha_extracciones.length > 0 && (
                        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
                            <h3 className="text-base font-bold">Historial de extracciones ({ficha.ficha_extracciones.length})</h3>
                            <div className="space-y-3">
                                {ficha.ficha_extracciones.map(e => (
                                    <div key={e.id} className="p-3 bg-slate-50 rounded-xl text-xs space-y-1">
                                        <div className="flex items-center justify-between">
                                            <span className="font-mono text-slate-500">{e.id.slice(0, 8)}…</span>
                                            <div className="flex items-center gap-2">
                                                {e.aplicada_a_ficha && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                                                <span className="text-slate-400">{new Date(e.created_at).toLocaleDateString('es-MX')}</span>
                                            </div>
                                        </div>
                                        {e.extraccion_cruda?.nombre && <p className="text-slate-600">Nombre: <span className="font-medium">{String(e.extraccion_cruda.nombre)}</span></p>}
                                        {e.extraccion_cruda?.confidence && <p className="text-slate-400">Confianza: {Math.round(Number(e.extraccion_cruda.confidence) * 100)}%</p>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Sidebar ── */}
                <div className="space-y-4">

                    {/* Cambiar estado */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
                        <h3 className="text-sm font-bold">Cambiar estado</h3>
                        <div className="space-y-2">
                            {ESTADOS.map(e => (
                                <button key={e} type="button" onClick={() => cambiarEstado(e)} disabled={saving || ficha.estado === e}
                                    className={`w-full py-2.5 px-4 rounded-xl text-sm font-semibold border transition-colors ${ficha.estado === e ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`}>
                                    {e === 'borrador' ? '📝 Borrador' : e === 'revision' ? '🔍 En revisión' : '✅ Publicada'}
                                </button>
                            ))}
                        </div>
                        {savedOk && <p className="text-xs text-emerald-600 font-semibold text-center">✓ Estado actualizado</p>}
                    </div>

                    {/* Acciones */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
                        <h3 className="text-sm font-bold">Acciones</h3>
                        <Link href="/fichas"
                            className="block w-full py-2.5 px-4 rounded-xl text-sm font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 text-center transition-colors">
                            ← Volver al listado
                        </Link>
                        <Link href="/autoficha"
                            className="block w-full py-2.5 px-4 rounded-xl text-sm font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 text-center transition-colors">
                            Nueva ficha con IA
                        </Link>
                        {ficha.estado !== 'publicada' && (
                            <button type="button" onClick={eliminarFicha} disabled={deleting}
                                className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                                {deleting
                                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Eliminando…</>
                                    : <><Trash2 className="w-4 h-4" /> Eliminar ficha</>}
                            </button>
                        )}
                        {ficha.estado === 'publicada' && (
                            <p className="text-xs text-slate-400 text-center">Las fichas publicadas no se pueden eliminar. Cámbiala a borrador primero.</p>
                        )}
                    </div>

                    {/* Completitud */}
                    {(() => {
                        const campos = [
                            ficha.descripcion, ficha.descripcion_larga, ficha.fabricante,
                            ficha.especificaciones, ficha.uso_recomendado, ficha.precauciones,
                            ficha.ingredientes,
                        ];
                        const listas = [ficha.bullet_points?.length, ficha.palabras_clave?.length];
                        const filled = campos.filter(Boolean).length + listas.filter(l => l && l > 0).length;
                        const total  = campos.length + listas.length;
                        const pct    = Math.round((filled / total) * 100);
                        const color  = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-rose-400';
                        return (
                            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-2">
                                <h3 className="text-sm font-bold">Completitud</h3>
                                <div className="flex items-center gap-3">
                                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
                                    </div>
                                    <span className="text-sm font-bold text-slate-600">{pct}%</span>
                                </div>
                                <p className="text-xs text-slate-400">{filled} de {total} campos de contenido llenos</p>
                            </div>
                        );
                    })()}
                </div>
            </div>
        </div>
    );
}
