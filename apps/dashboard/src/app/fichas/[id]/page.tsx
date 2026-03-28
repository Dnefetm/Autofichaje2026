"use client";

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    ArrowLeft, Loader2, AlertCircle, FileText, Link2, CheckCircle2,
    ExternalLink, Trash2, Edit2, Save, X, Tag, List, Sparkles,
    Upload, ChevronDown, ChevronRight,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Estado = 'borrador' | 'revision' | 'publicada';

interface Articulo {
    articulo_id: string; nombre: string; marca: string;
    modelo?: string; variante?: string; codigo_universal?: string;
    categoria?: string; peso_kg?: number;
    largo_cm?: number; ancho_cm?: number; alto_cm?: number;
}

interface FichaDetalle {
    id: string; estado: string; created_at: string;
    nombre_producto: string;
    descripcion?: string;
    descripcion_larga?: string;
    fabricante?: string;
    especificaciones?: string;
    ingredientes?: string;
    uso_recomendado?: string;
    precauciones?: string;
    bullet_points?: string[];
    palabras_clave?: string[];
    atributos_dinamicos?: Record<string, any>;
    atributos_categoria?: Record<string, any>;
    atributos_extras?: Record<string, any>;
    ficha_tecnica_data?: Record<string, any>;
    articulo_id?: string;
    articulos?: Articulo | null;
    ficha_extracciones?: Array<{
        id: string; extraccion_cruda: any; aplicada_a_ficha: boolean; created_at: string;
    }>;
}

type TipoCampo = 'texto' | 'lista' | 'jsonb';
type AccionCampo = 'agregar' | 'conflicto';

interface Discrepancia {
    campo: string; label: string; tipo: TipoCampo; accion: AccionCampo;
    valor_actual: any; valor_nuevo: any;
    // listas
    items_nuevos?: string[];
    // jsonb
    keys_nuevas?: Record<string, any>;
    keys_conflicto?: Record<string, { actual: any; nuevo: any }>;
}

// ─── Helpers de UI ────────────────────────────────────────────────────────────

function EstadoBadge({ estado }: { estado: string }) {
    const MAP: Record<string, string> = {
        borrador: 'bg-slate-100 text-slate-600',
        revision: 'bg-amber-100 text-amber-700',
        publicada: 'bg-emerald-100 text-emerald-700',
    };
    return (
        <span className={`text-xs font-bold px-3 py-1 rounded-full capitalize ${MAP[estado] ?? 'bg-slate-100 text-slate-500'}`}>
            {estado}
        </span>
    );
}

function Label({ children }: { children: React.ReactNode }) {
    return <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">{children}</p>;
}

function TextBlock({ label, value }: { label: string; value?: string | null }) {
    if (!value) return null;
    return (
        <div>
            <Label>{label}</Label>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{value}</p>
        </div>
    );
}

/** Parsea texto "- Clave: valor\n- Clave2: valor2" a un objeto key-value */
function parseSpecsText(text: string): Record<string, string> | null {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const result: Record<string, string> = {};
    let valid = 0;
    for (const line of lines) {
        const cleaned = line.replace(/^[-•*]\s*/, '');
        const colonIdx = cleaned.indexOf(':');
        if (colonIdx > 0 && colonIdx < cleaned.length - 1) {
            const k = cleaned.slice(0, colonIdx).trim();
            const v = cleaned.slice(colonIdx + 1).trim();
            if (k && v) { result[k] = v; valid++; }
        }
    }
    return valid >= 2 ? result : null;
}

function KVGrid({ data, label }: { data: Record<string, any>; label?: string }) {
    if (!data || Object.keys(data).length === 0) return null;
    return (
        <div>
            {label && <Label>{label}</Label>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-1">
                {Object.entries(data).map(([k, v]) => (
                    <div key={k} className="flex gap-2 bg-slate-50 rounded-lg px-3 py-2 text-xs">
                        <span className="font-medium text-slate-500 shrink-0 min-w-0 break-words">{k}:</span>
                        <span className="text-slate-700 break-words">{String(v ?? '')}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function EditField({ label, value, onChange, type = 'text' }: {
    label: string; value?: string; onChange: (v: string) => void; type?: 'text' | 'textarea';
}) {
    const cls = "w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-1 focus:ring-indigo-500 outline-none";
    return (
        <div className="space-y-1">
            <Label>{label}</Label>
            {type === 'textarea'
                ? <textarea className={`${cls} h-24 resize-none`} value={value ?? ''} onChange={e => onChange(e.target.value)} />
                : <input className={cls} value={value ?? ''} onChange={e => onChange(e.target.value)} />
            }
        </div>
    );
}

// ─── Componente principal ─────────────────────────────────────────────────────

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
    const [editMode, setEditMode]     = useState(false);
    const [draft, setDraft]           = useState<Partial<FichaDetalle>>({});
    const [patchSaving, setPatchSaving] = useState(false);
    const [patchError, setPatchError]   = useState('');

    // Enriquecimiento
    const [enrichOpen, setEnrichOpen]     = useState(false);
    const [enrichFile, setEnrichFile]     = useState<File | null>(null);
    const [enrichUrl, setEnrichUrl]       = useState('');
    const [enrichMode, setEnrichMode]     = useState<'file' | 'url'>('file');
    const [enrichLoading, setEnrichLoading] = useState(false);
    const [enrichError, setEnrichError]   = useState('');
    const enrichFileRef                   = useRef<HTMLInputElement>(null);

    // Modal comparación
    const [conflictos, setConflictos]         = useState<Discrepancia[]>([]);
    const [extraccionId, setExtraccionId]     = useState<string | null>(null);
    // seleccion: 'actual' | 'nuevo' | 'combinar'
    const [seleccion, setSeleccion]           = useState<Record<string, string>>({});
    // checkboxes para items de listas
    const [listChecks, setListChecks]         = useState<Record<string, Set<string>>>({});
    // valores combinados editables por campo
    const [combinados, setCombinados]         = useState<Record<string, string>>({});
    const [combinandoField, setCombinandoField] = useState<string | null>(null);
    const [applying, setApplying]             = useState(false);
    const [applyError, setApplyError]         = useState('');
    const [showModal, setShowModal]           = useState(false);
    const [enrichedMsg, setEnrichedMsg]       = useState('');

    // Fetch datos
    useEffect(() => {
        if (!id) return;
        (async () => {
            setLoading(true);
            const { data, error: err } = await supabase
                .from('fichas_tecnicas')
                .select(`
                    id, estado, created_at,
                    nombre_producto, descripcion, descripcion_larga,
                    fabricante, especificaciones, ingredientes,
                    uso_recomendado, precauciones,
                    bullet_points, palabras_clave,
                    atributos_dinamicos, atributos_categoria, atributos_extras,
                    ficha_tecnica_data, articulo_id,
                    articulos ( articulo_id, nombre, marca, modelo, variante, codigo_universal, categoria, peso_kg, largo_cm, ancho_cm, alto_cm ),
                    ficha_extracciones ( id, extraccion_cruda, aplicada_a_ficha, created_at )
                `)
                .eq('id', id)
                .single();
            if (err) setError(err.message);
            else setFicha(data as unknown as FichaDetalle);
            setLoading(false);
        })();
    }, [id]);

    // ── Cambiar estado ────────────────────────────────────────────────────────

    async function cambiarEstado(e: Estado) {
        if (!ficha) return;
        setSaving(true);
        const { error: err } = await supabase.from('fichas_tecnicas').update({ estado: e }).eq('id', ficha.id);
        if (!err) { setFicha(p => p ? { ...p, estado: e } : p); setSavedOk(true); setTimeout(() => setSavedOk(false), 2000); }
        setSaving(false);
    }

    // ── Eliminar ──────────────────────────────────────────────────────────────

    async function eliminarFicha() {
        if (!ficha) return;
        if (!window.confirm(`¿Eliminar "${ficha.nombre_producto}"?\nEsta acción no se puede deshacer.`)) return;
        setDeleting(true);
        const res  = await fetch(`/api/fichas/${ficha.id}`, { method: 'DELETE' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { setError(body?.error || 'Error al eliminar.'); setDeleting(false); return; }
        router.push('/fichas');
    }

    // ── Edición ───────────────────────────────────────────────────────────────

    function startEdit() {
        if (!ficha) return;
        setDraft({
            nombre_producto: ficha.nombre_producto,
            descripcion: ficha.descripcion, descripcion_larga: ficha.descripcion_larga,
            fabricante: ficha.fabricante, especificaciones: ficha.especificaciones,
            ingredientes: ficha.ingredientes, uso_recomendado: ficha.uso_recomendado,
            precauciones: ficha.precauciones,
            bullet_points:  ficha.bullet_points  ? [...ficha.bullet_points]  : [],
            palabras_clave: ficha.palabras_clave ? [...ficha.palabras_clave] : [],
        });
        setPatchError(''); setEditMode(true);
    }

    async function saveEdit() {
        if (!ficha) return;
        setPatchSaving(true); setPatchError('');
        const res = await fetch(`/api/fichas/${ficha.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { setPatchError(body?.error || 'Error al guardar.'); setPatchSaving(false); return; }
        setFicha(p => p ? { ...p, ...body.ficha } : p);
        setEditMode(false); setDraft({}); setPatchSaving(false);
    }

    // ── Enriquecimiento ───────────────────────────────────────────────────────

    async function lanzarEnriquecimiento() {
        if (!ficha) return;
        if (enrichMode === 'file' && !enrichFile) { setEnrichError('Selecciona un archivo.'); return; }
        if (enrichMode === 'url' && !enrichUrl.startsWith('http')) { setEnrichError('URL inválida.'); return; }
        setEnrichLoading(true); setEnrichError('');

        let res: Response;
        if (enrichMode === 'file' && enrichFile) {
            const form = new FormData();
            form.append('file', enrichFile);
            res = await fetch(`/api/fichas/${ficha.id}/enriquecer`, { method: 'POST', body: form });
        } else {
            res = await fetch(`/api/fichas/${ficha.id}/enriquecer`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: enrichUrl }),
            });
        }

        const data = await res.json().catch(() => ({}));
        setEnrichLoading(false);
        setEnrichOpen(false); setEnrichFile(null); setEnrichUrl('');
        if (!res.ok) { setEnrichError(data?.error || 'Error al enriquecer.'); return; }

        if (data.sin_cambios) {
            setEnrichedMsg('Sin cambios — los datos ya estaban en la ficha.');
            return;
        }
        if (data.campos_agregados?.length > 0 && data.total_conflictos === 0) {
            setEnrichedMsg(`✓ ${data.campos_agregados.length} campo(s) agregados automáticamente.`);
            // Reload ficha
            const { data: updated } = await supabase.from('fichas_tecnicas')
                .select('*, articulos(*), ficha_extracciones(*)')
                .eq('id', ficha.id).single();
            if (updated) setFicha(updated as unknown as FichaDetalle);
            return;
        }

        // Inicializar selección — texto: 'actual'; listas/jsonb con solo nuevos: 'nuevo'
        const sel: Record<string, string> = {};
        const checks: Record<string, Set<string>> = {};
        for (const d of (data.conflictos ?? [])) {
            if (d.tipo === 'lista') {
                sel[d.campo] = 'nuevo';
                checks[d.campo] = new Set(d.items_nuevos ?? []);
            } else {
                sel[d.campo] = 'actual';
            }
        }

        setConflictos(data.conflictos ?? []);
        setExtraccionId(data.extraccion_id);
        setSeleccion(sel);
        setListChecks(checks);
        setCombinados({});
        if (data.campos_agregados?.length > 0) {
            setEnrichedMsg(`✓ ${data.campos_agregados.length} campo(s) vacíos completados automáticamente.`);
        }
        setShowModal(true);
    }

    async function enrichFromCatalog() {
        if (!ficha?.articulos) return;
        const art = ficha.articulos as any;
        // Mapear campos del artículo a campos de fichas_tecnicas
        const campos: Record<string, any> = {};
        const camposNuevosLabels: string[] = [];
        const MAP = [
            { art: 'materiales',  ficha: 'especificaciones', label: 'Materiales' },
            { art: 'pais_origen', ficha: 'especificaciones', label: 'País de origen' },
        ];
        // Atributos del artículo → atributos_dinamicos de la ficha
        const atribNuevos: Record<string, any> = {};
        if (art.peso_kg)  { atribNuevos['Peso (kg)'] = art.peso_kg; }
        if (art.largo_cm) { atribNuevos['Largo (cm)'] = art.largo_cm; }
        if (art.ancho_cm) { atribNuevos['Ancho (cm)'] = art.ancho_cm; }
        if (art.alto_cm)  { atribNuevos['Alto (cm)']  = art.alto_cm; }
        if (art.codigo_universal) { atribNuevos['Código de barras'] = art.codigo_universal; }
        if (art.categoria)        { atribNuevos['Categoría'] = art.categoria; }

        if (Object.keys(atribNuevos).length > 0) {
            const actual = ficha.atributos_dinamicos ?? {};
            const merged = { ...actual };
            for (const [k, v] of Object.entries(atribNuevos)) {
                if (!(k in actual)) { merged[k] = v; camposNuevosLabels.push(k); }
            }
            if (camposNuevosLabels.length > 0) campos['atributos_dinamicos'] = merged;
        }

        if (Object.keys(campos).length === 0) {
            setEnrichedMsg('El catálogo no aporta datos nuevos a esta ficha.');
            return;
        }

        const res = await fetch(`/api/fichas/${ficha.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(campos),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { setEnrichedMsg(`Error: ${body?.error}`); return; }
        setFicha(p => p ? { ...p, ...body.ficha } : p);
        setEnrichedMsg(`✓ ${camposNuevosLabels.join(', ')} agregados desde el catálogo.`);
    }

    async function combinarConIA(d: Discrepancia) {
        setCombinandoField(d.campo);
        const res = await fetch(`/api/fichas/${ficha!.id}/combinar`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ campo: d.campo, label: d.label, valor_actual: String(d.valor_actual ?? ''), valor_nuevo: String(d.valor_nuevo ?? '') }),
        });
        const body = await res.json().catch(() => ({}));
        setCombinandoField(null);
        if (body.valor_combinado) {
            setCombinados(c => ({ ...c, [d.campo]: body.valor_combinado }));
            setSeleccion(s => ({ ...s, [d.campo]: 'combinar' }));
        }
    }

    async function aplicarSeleccion() {
        if (!ficha) return;
        setApplying(true); setApplyError('');

        const campos_aceptados: Record<string, any> = {};
        for (const d of conflictos) {
            const sel = seleccion[d.campo];
            if (d.tipo === 'lista') {
                // Union: actual + items marcados en listChecks
                const checks = listChecks[d.campo] ?? new Set();
                const actual = d.valor_actual ?? [];
                const merged = [...actual, ...(d.items_nuevos ?? []).filter(i => checks.has(i))];
                if (merged.length > actual.length) campos_aceptados[d.campo] = merged;
            } else if (d.tipo === 'jsonb') {
                if (sel === 'nuevo') {
                    campos_aceptados[d.campo] = { ...(d.valor_actual ?? {}), ...d.valor_nuevo };
                }
            } else {
                if (sel === 'nuevo')    campos_aceptados[d.campo] = d.valor_nuevo;
                if (sel === 'combinar') campos_aceptados[d.campo] = combinados[d.campo] ?? d.valor_nuevo;
            }
        }

        if (Object.keys(campos_aceptados).length === 0) {
            setShowModal(false); setApplying(false); return;
        }

        const res = await fetch(`/api/fichas/${ficha.id}/aplicar`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ extraccion_id: extraccionId, campos_aceptados }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { setApplyError(body?.error || 'Error al aplicar.'); setApplying(false); return; }

        const { data: updated } = await supabase
            .from('fichas_tecnicas').select('*, articulos(*), ficha_extracciones(*)')
            .eq('id', ficha.id).single();
        if (updated) setFicha(updated as unknown as FichaDetalle);
        setShowModal(false); setApplying(false);
    }

    function formatVal(v: any): string {
        if (Array.isArray(v)) return v.join(' · ') || '(vacío)';
        return v != null && v !== '' ? String(v) : '(vacío)';
    }

    // ─── Guards ───────────────────────────────────────────────────────────────

    if (loading) return <div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Cargando…</div>;
    if (error)   return <div className="flex gap-3 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700"><AlertCircle className="w-5 h-5 shrink-0" />{error}</div>;
    if (!ficha)  return null;

    const art = ficha.articulos;
    const specsKV = ficha.especificaciones ? parseSpecsText(ficha.especificaciones) : null;
    const hasAtribDin = ficha.atributos_dinamicos && Object.keys(ficha.atributos_dinamicos).length > 0;
    const hasAtribCat = ficha.atributos_categoria && Object.keys(ficha.atributos_categoria).length > 0;
    const hasAtribExt = ficha.atributos_extras    && Object.keys(ficha.atributos_extras).length > 0;

    // Completitud
    const camposEval = [
        ficha.descripcion, ficha.descripcion_larga, ficha.fabricante,
        ficha.especificaciones, ficha.uso_recomendado, ficha.precauciones, ficha.ingredientes,
    ];
    const listasEval = [ficha.bullet_points?.length, ficha.palabras_clave?.length];
    const filled = camposEval.filter(Boolean).length + listasEval.filter(l => l && l > 0).length;
    const totalEval = camposEval.length + listasEval.length;
    const completitud = Math.round((filled / totalEval) * 100);
    const completitudColor = completitud >= 80 ? 'bg-emerald-500' : completitud >= 50 ? 'bg-amber-400' : 'bg-rose-400';

    // ─── JSX ─────────────────────────────────────────────────────────────────

    return (
        <div className="max-w-5xl mx-auto space-y-5 pb-12">

            {/* ── Header ── */}
            <div className="flex items-center gap-3 flex-wrap">
                <button type="button" onClick={() => router.back()} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 transition-colors">
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex-1 min-w-0">
                    <h1 className="text-2xl font-bold truncate">{ficha.nombre_producto || 'Ficha sin nombre'}</h1>
                    <p className="text-slate-400 text-xs font-mono">{ficha.id}</p>
                </div>
                <EstadoBadge estado={ficha.estado} />
                {!editMode && (
                    <button type="button" onClick={startEdit}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-white border border-slate-200 text-slate-600 rounded-xl hover:border-indigo-300 hover:text-indigo-700 transition-colors">
                        <Edit2 className="w-4 h-4" /> Editar
                    </button>
                )}
            </div>

            {/* Banner edición */}
            {editMode && (
                <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-2xl px-5 py-3 gap-3 flex-wrap">
                    <p className="text-sm font-semibold text-indigo-700">Modo edición activo</p>
                    <div className="flex gap-2">
                        <button type="button" onClick={() => { setEditMode(false); setDraft({}); }}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
                            <X className="w-4 h-4" /> Cancelar
                        </button>
                        <button type="button" onClick={saveEdit} disabled={patchSaving}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60">
                            {patchSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
                        </button>
                    </div>
                </div>
            )}
            {patchError && <div className="flex gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm"><AlertCircle className="w-4 h-4 shrink-0" />{patchError}</div>}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

                {/* ── Columna principal ── */}
                <div className="lg:col-span-2 space-y-4">

                    {/* NIVEL 1 — Identidad del producto */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
                        <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Identidad del producto</h2>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                            {art?.articulo_id && (
                                <div><Label>SKU</Label><p className="font-mono font-bold text-slate-800">{art.articulo_id}</p></div>
                            )}
                            {art?.marca && (
                                <div><Label>Marca</Label><p className="font-semibold text-slate-800">{art.marca}</p></div>
                            )}
                            {art?.modelo && (
                                <div><Label>Modelo</Label><p className="text-slate-700">{art.modelo}</p></div>
                            )}
                            {art?.variante && (
                                <div><Label>Variante</Label><p className="text-slate-700">{art.variante}</p></div>
                            )}
                            {(ficha.fabricante || art?.marca) && (
                                <div className="col-span-2 sm:col-span-1">
                                    <Label>Fabricante</Label>
                                    {editMode
                                        ? <input className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm" value={draft.fabricante ?? ''} onChange={e => setDraft(d => ({ ...d, fabricante: e.target.value }))} />
                                        : <p className="text-slate-700">{ficha.fabricante}</p>}
                                </div>
                            )}
                            {art?.codigo_universal && (
                                <div><Label>Código de barras (EAN)</Label><p className="font-mono text-slate-700">{art.codigo_universal}</p></div>
                            )}
                            {art?.categoria && (
                                <div><Label>Categoría</Label><p className="text-slate-700">{art.categoria}</p></div>
                            )}
                        </div>
                        {/* Dimensiones del artículo */}
                        {art && (art.peso_kg || art.largo_cm || art.ancho_cm || art.alto_cm) && (
                            <div className="border-t border-slate-100 pt-3">
                                <Label>Dimensiones y peso</Label>
                                <div className="flex flex-wrap gap-4 mt-1 text-sm">
                                    {art.largo_cm && <span className="text-slate-600"><b>L:</b> {art.largo_cm} cm</span>}
                                    {art.ancho_cm && <span className="text-slate-600"><b>A:</b> {art.ancho_cm} cm</span>}
                                    {art.alto_cm  && <span className="text-slate-600"><b>H:</b> {art.alto_cm} cm</span>}
                                    {art.peso_kg  && <span className="text-slate-600"><b>Peso:</b> {art.peso_kg} kg</span>}
                                </div>
                            </div>
                        )}
                        {art && (
                            <div className="border-t border-slate-100 pt-2">
                                <Link href={`/catalog?q=${art.articulo_id}`} target="_blank"
                                    className="inline-flex items-center gap-1 text-indigo-500 hover:text-indigo-700 text-xs font-semibold">
                                    <Link2 className="w-3 h-3" /> Ver en catálogo <ExternalLink className="w-3 h-3" />
                                </Link>
                            </div>
                        )}
                        {!art && (
                            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
                                Sin artículo del catálogo vinculado.{' '}
                                <Link href="/autoficha" className="underline font-semibold">Ir a Crear con IA</Link>
                            </div>
                        )}
                    </div>

                    {/* NIVEL 2 — Descripción comercial */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
                        <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Descripción comercial</h2>
                        {editMode ? (
                            <div className="space-y-3">
                                <EditField label="Descripción corta" value={draft.descripcion} onChange={v => setDraft(d => ({ ...d, descripcion: v }))} type="textarea" />
                                <EditField label="Descripción extendida" value={draft.descripcion_larga} onChange={v => setDraft(d => ({ ...d, descripcion_larga: v }))} type="textarea" />
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <TextBlock label="Descripción corta" value={ficha.descripcion} />
                                <TextBlock label="Descripción extendida" value={ficha.descripcion_larga} />
                            </div>
                        )}

                        {/* Bullet points */}
                        {(ficha.bullet_points?.length || editMode) ? (
                            <div>
                                <Label>Puntos clave</Label>
                                {editMode ? (
                                    <div className="space-y-1.5 mt-1">
                                        {(draft.bullet_points ?? []).map((bp, i) => (
                                            <div key={i} className="flex gap-2">
                                                <input value={bp} onChange={e => {
                                                    const arr = [...(draft.bullet_points ?? [])]; arr[i] = e.target.value;
                                                    setDraft(d => ({ ...d, bullet_points: arr }));
                                                }} className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-indigo-500 outline-none" />
                                                <button type="button" onClick={() => setDraft(d => ({ ...d, bullet_points: (d.bullet_points ?? []).filter((_, j) => j !== i) }))}
                                                    className="text-slate-300 hover:text-rose-500 shrink-0"><X className="w-4 h-4" /></button>
                                            </div>
                                        ))}
                                        <button type="button" onClick={() => setDraft(d => ({ ...d, bullet_points: [...(d.bullet_points ?? []), ''] }))}
                                            className="text-xs text-indigo-500 hover:text-indigo-700">+ Agregar punto</button>
                                    </div>
                                ) : (
                                    <ul className="mt-1 space-y-1">
                                        {(ficha.bullet_points ?? []).map((bp, i) => (
                                            <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                                                <span className="text-indigo-400 shrink-0 mt-0.5">▸</span>{bp}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ) : null}
                    </div>

                    {/* NIVEL 3 — Especificaciones técnicas */}
                    {(ficha.especificaciones || hasAtribDin || hasAtribCat || editMode) && (
                        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
                            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Especificaciones técnicas</h2>
                            {editMode ? (
                                <EditField label="Especificaciones" value={draft.especificaciones} onChange={v => setDraft(d => ({ ...d, especificaciones: v }))} type="textarea" />
                            ) : (
                                <>
                                    {ficha.especificaciones && (
                                        specsKV
                                            ? <KVGrid data={specsKV} label="Especificaciones (detectadas)" />
                                            : <TextBlock label="Especificaciones" value={ficha.especificaciones} />
                                    )}
                                    {hasAtribCat && <KVGrid data={ficha.atributos_categoria!} label={`Atributos de categoría`} />}
                                    {hasAtribDin && <KVGrid data={ficha.atributos_dinamicos!} label="Atributos técnicos (IA)" />}
                                    {hasAtribExt && <KVGrid data={ficha.atributos_extras!} label="Atributos adicionales" />}
                                </>
                            )}
                        </div>
                    )}

                    {/* NIVEL 4 — Información complementaria */}
                    {(ficha.uso_recomendado || ficha.precauciones || ficha.ingredientes || editMode) && (
                        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
                            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Información complementaria</h2>
                            {editMode ? (
                                <div className="space-y-3">
                                    <EditField label="Uso recomendado" value={draft.uso_recomendado} onChange={v => setDraft(d => ({ ...d, uso_recomendado: v }))} type="textarea" />
                                    <EditField label="Precauciones" value={draft.precauciones} onChange={v => setDraft(d => ({ ...d, precauciones: v }))} type="textarea" />
                                    <EditField label="Ingredientes / Composición" value={draft.ingredientes} onChange={v => setDraft(d => ({ ...d, ingredientes: v }))} type="textarea" />
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <TextBlock label="Uso recomendado" value={ficha.uso_recomendado} />
                                    <TextBlock label="Precauciones" value={ficha.precauciones} />
                                    <TextBlock label="Ingredientes / Composición" value={ficha.ingredientes} />
                                </div>
                            )}
                        </div>
                    )}

                    {/* NIVEL 5 — Marketplace */}
                    {(ficha.palabras_clave?.length || editMode) ? (
                        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-3">
                            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                <Tag className="w-4 h-4" /> Marketplace
                            </h2>
                            <div>
                                <Label>Palabras clave</Label>
                                {editMode ? (
                                    <div className="space-y-2 mt-1">
                                        <div className="flex flex-wrap gap-1.5">
                                            {(draft.palabras_clave ?? []).map((kw, i) => (
                                                <span key={i} className="flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs px-2 py-1 rounded-full">
                                                    {kw}
                                                    <button type="button" onClick={() => setDraft(d => ({ ...d, palabras_clave: (d.palabras_clave ?? []).filter((_, j) => j !== i) }))}
                                                        className="hover:text-rose-500"><X className="w-2.5 h-2.5" /></button>
                                                </span>
                                            ))}
                                        </div>
                                        <input placeholder="Agregar keyword y Enter" onKeyDown={e => {
                                            if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                                setDraft(d => ({ ...d, palabras_clave: [...(d.palabras_clave ?? []), e.currentTarget.value.trim()] }));
                                                e.currentTarget.value = '';
                                            }
                                        }} className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-indigo-500 outline-none" />
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap gap-1.5 mt-1">
                                        {(ficha.palabras_clave ?? []).map((kw, i) => (
                                            <span key={i} className="bg-indigo-50 text-indigo-700 text-xs font-semibold px-3 py-1 rounded-full">{kw}</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : null}

                    {/* Historial de extracciones (colapsable) */}
                    {ficha.ficha_extracciones && ficha.ficha_extracciones.length > 0 && (
                        <details className="bg-white border border-slate-200 rounded-2xl shadow-sm">
                            <summary className="px-6 py-4 cursor-pointer text-sm font-bold text-slate-600 flex items-center gap-2 list-none">
                                <FileText className="w-4 h-4 text-slate-400" />
                                Historial de extracciones ({ficha.ficha_extracciones.length})
                                <ChevronRight className="w-4 h-4 text-slate-300 ml-auto" />
                            </summary>
                            <div className="px-6 pb-5 space-y-2 border-t border-slate-100 pt-3">
                                {ficha.ficha_extracciones.map(e => (
                                    <div key={e.id} className="p-3 bg-slate-50 rounded-xl text-xs space-y-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-mono text-slate-400">{e.id.slice(0, 8)}…</span>
                                            <div className="flex items-center gap-2">
                                                {e.aplicada_a_ficha
                                                    ? <span className="text-emerald-600 font-semibold flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Aplicada</span>
                                                    : <span className="text-amber-600 font-semibold">Pendiente</span>}
                                                <span className="text-slate-400">{new Date(e.created_at).toLocaleDateString('es-MX')}</span>
                                            </div>
                                        </div>
                                        {e.extraccion_cruda?.nombre && <p className="text-slate-600">Nombre: <strong>{String(e.extraccion_cruda.nombre)}</strong></p>}
                                        {e.extraccion_cruda?.confidence != null && <p className="text-slate-400">Confianza: {Math.round(Number(e.extraccion_cruda.confidence) * 100)}%</p>}
                                    </div>
                                ))}
                            </div>
                        </details>
                    )}
                </div>

                {/* ── Sidebar ── */}
                <div className="space-y-4">

                    {/* Enriquecer */}
                    <div className="bg-gradient-to-br from-indigo-600 to-violet-600 rounded-2xl p-5 text-white shadow-lg space-y-3">
                        <div className="flex items-center gap-2">
                            <Sparkles className="w-5 h-5" />
                            <h3 className="text-sm font-bold">Enriquecer ficha</h3>
                        </div>
                        {enrichedMsg && (
                            <p className="text-xs bg-white/20 rounded-lg px-3 py-2 text-white">{enrichedMsg}</p>
                        )}
                        {!enrichOpen ? (
                            <div className="space-y-2">
                                <button type="button" onClick={() => { setEnrichOpen(true); setEnrichedMsg(''); }}
                                    className="w-full py-2.5 px-4 rounded-xl text-sm font-bold bg-white text-indigo-700 hover:bg-indigo-50 transition-colors flex items-center justify-center gap-2">
                                    <Upload className="w-4 h-4" /> Agregar documento
                                </button>
                                {ficha.articulos && (
                                    <button type="button" onClick={() => { enrichFromCatalog(); setEnrichedMsg(''); }}
                                        className="w-full py-2 px-4 rounded-xl text-xs font-semibold border border-indigo-400 text-indigo-100 hover:bg-white/10 transition-colors flex items-center justify-center gap-2">
                                        <Link2 className="w-3.5 h-3.5" /> Enriquecer desde catálogo
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="flex gap-1">
                                    {(['file', 'url'] as const).map(m => (
                                        <button key={m} type="button" onClick={() => setEnrichMode(m)}
                                            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${enrichMode === m ? 'bg-white text-indigo-700' : 'text-indigo-200 hover:text-white'}`}>
                                            {m === 'file' ? '📄 Archivo' : '🔗 URL'}
                                        </button>
                                    ))}
                                </div>
                                {enrichMode === 'file' ? (
                                    <>
                                        <input ref={enrichFileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className="hidden"
                                            onChange={e => setEnrichFile(e.target.files?.[0] ?? null)} />
                                        <button type="button" onClick={() => enrichFileRef.current?.click()}
                                            className="w-full py-2 rounded-xl border-2 border-dashed border-indigo-400 text-xs text-indigo-200 hover:border-white hover:text-white transition-colors">
                                            {enrichFile ? enrichFile.name : 'Seleccionar archivo…'}
                                        </button>
                                    </>
                                ) : (
                                    <input type="url" placeholder="https://…/ficha.pdf" value={enrichUrl}
                                        onChange={e => setEnrichUrl(e.target.value)}
                                        className="w-full p-2 rounded-xl bg-indigo-700 border border-indigo-500 text-xs text-white placeholder-indigo-300 focus:outline-none" />
                                )}
                                {enrichError && <p className="text-xs text-rose-200">{enrichError}</p>}
                                <div className="flex gap-2">
                                    <button type="button" onClick={() => { setEnrichOpen(false); setEnrichFile(null); setEnrichUrl(''); setEnrichError(''); }}
                                        className="flex-1 py-2 rounded-xl text-xs border border-indigo-400 text-indigo-200 hover:text-white transition-colors">Cancelar</button>
                                    <button type="button" onClick={lanzarEnriquecimiento} disabled={enrichLoading}
                                        className="flex-1 py-2 rounded-xl text-xs font-bold bg-white text-indigo-700 hover:bg-indigo-50 transition-colors disabled:opacity-60 flex items-center justify-center gap-1">
                                        {enrichLoading ? <><Loader2 className="w-3 h-3 animate-spin" />Procesando…</> : 'Extraer con IA'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Cambiar estado */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
                        <h3 className="text-sm font-bold">Estado</h3>
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

                    {/* Completitud */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-2">
                        <h3 className="text-sm font-bold">Completitud</h3>
                        <div className="flex items-center gap-3">
                            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${completitudColor}`} style={{ width: `${completitud}%` }} />
                            </div>
                            <span className="text-sm font-bold text-slate-600">{completitud}%</span>
                        </div>
                        <p className="text-xs text-slate-400">{filled} de {totalEval} campos de contenido llenos</p>
                    </div>

                    {/* Acciones */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-2">
                        <h3 className="text-sm font-bold">Acciones</h3>
                        <Link href="/fichas" className="block w-full py-2.5 px-4 rounded-xl text-sm font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 text-center transition-colors">
                            ← Listado de fichas
                        </Link>
                        <Link href="/autoficha" className="block w-full py-2.5 px-4 rounded-xl text-sm font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 text-center transition-colors">
                            Nueva ficha con IA
                        </Link>
                        {ficha.estado !== 'publicada' && (
                            <button type="button" onClick={eliminarFicha} disabled={deleting}
                                className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                                {deleting ? <><Loader2 className="w-4 h-4 animate-spin" />Eliminando…</> : <><Trash2 className="w-4 h-4" />Eliminar ficha</>}
                            </button>
                        )}
                    </div>

                    {/* Metadata */}
                    <div className="text-xs text-slate-400 space-y-1 px-1">
                        <p>Creada: {new Date(ficha.created_at).toLocaleString('es-MX')}</p>
                    </div>
                </div>
            </div>

            {/* ── Modal enriquecimiento v2 ── */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                            <div>
                                <h2 className="text-lg font-bold">Resolver conflictos</h2>
                                <p className="text-xs text-slate-400">{conflictos.length} campo(s) con datos diferentes. Mantener, usar nuevo o combinar.</p>
                                {enrichedMsg && <p className="text-xs text-emerald-600 font-semibold mt-1">{enrichedMsg}</p>}
                            </div>
                            <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
                        </div>

                        <div className="overflow-y-auto flex-1 p-6 space-y-5">
                            {conflictos.map(d => (
                                <div key={d.campo} className="border border-slate-200 rounded-xl overflow-hidden">
                                    <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                                        <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">{d.label}</p>
                                        <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{d.tipo}</span>
                                    </div>

                                    {/* LISTAS — checkboxes de items nuevos */}
                                    {d.tipo === 'lista' && (
                                        <div className="p-4 space-y-2">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Items actuales</p>
                                            {(d.valor_actual ?? []).map((item: string) => (
                                                <div key={item} className="flex items-center gap-2 text-xs text-slate-500">
                                                    <span className="w-3 h-3 rounded border border-slate-300 bg-slate-100 shrink-0" />{item}
                                                </div>
                                            ))}
                                            {d.items_nuevos && d.items_nuevos.length > 0 && (
                                                <>
                                                    <p className="text-[10px] font-bold text-emerald-600 uppercase mt-3 mb-2">Items nuevos — elige cuáles agregar</p>
                                                    {d.items_nuevos.map((item: string) => {
                                                        const checked = listChecks[d.campo]?.has(item) ?? true;
                                                        return (
                                                            <label key={item} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                                                                <input type="checkbox" checked={checked} onChange={e => {
                                                                    setListChecks(prev => {
                                                                        const s = new Set(prev[d.campo] ?? []);
                                                                        e.target.checked ? s.add(item) : s.delete(item);
                                                                        return { ...prev, [d.campo]: s };
                                                                    });
                                                                }} className="accent-indigo-600" />
                                                                <span className="text-emerald-700 font-medium">{item}</span>
                                                            </label>
                                                        );
                                                    })}
                                                </>
                                            )}
                                        </div>
                                    )}

                                    {/* TEXTO — 3 botones + combinar editable */}
                                    {d.tipo === 'texto' && (
                                        <div className="p-4 space-y-3">
                                            <div className="grid grid-cols-2 gap-2">
                                                <button type="button" onClick={() => setSeleccion(s => ({ ...s, [d.campo]: 'actual' }))}
                                                    className={`p-3 rounded-lg text-xs text-left border transition-colors ${seleccion[d.campo] === 'actual' ? 'border-indigo-400 bg-indigo-50 ring-1 ring-indigo-400' : 'border-slate-200 hover:bg-slate-50'}`}>
                                                    <p className={`font-bold mb-1 text-[10px] uppercase ${seleccion[d.campo] === 'actual' ? 'text-indigo-600' : 'text-slate-400'}`}>
                                                        {seleccion[d.campo] === 'actual' ? '✓ ' : ''}Mantener actual
                                                    </p>
                                                    <p className="text-slate-600 line-clamp-3 whitespace-pre-wrap">{formatVal(d.valor_actual)}</p>
                                                </button>
                                                <button type="button" onClick={() => setSeleccion(s => ({ ...s, [d.campo]: 'nuevo' }))}
                                                    className={`p-3 rounded-lg text-xs text-left border transition-colors ${seleccion[d.campo] === 'nuevo' ? 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-400' : 'border-slate-200 hover:bg-slate-50'}`}>
                                                    <p className={`font-bold mb-1 text-[10px] uppercase ${seleccion[d.campo] === 'nuevo' ? 'text-emerald-600' : 'text-slate-400'}`}>
                                                        {seleccion[d.campo] === 'nuevo' ? '✓ ' : ''}Usar nuevo
                                                    </p>
                                                    <p className="text-slate-600 line-clamp-3 whitespace-pre-wrap">{formatVal(d.valor_nuevo)}</p>
                                                </button>
                                            </div>
                                            {/* Combinar con IA */}
                                            <div className={`rounded-lg border p-3 space-y-2 transition-colors ${seleccion[d.campo] === 'combinar' ? 'border-violet-400 bg-violet-50' : 'border-slate-200'}`}>
                                                <div className="flex items-center justify-between">
                                                    <p className={`text-[10px] font-bold uppercase ${seleccion[d.campo] === 'combinar' ? 'text-violet-600' : 'text-slate-400'}`}>
                                                        {seleccion[d.campo] === 'combinar' ? '✓ ' : ''}Combinar con IA
                                                    </p>
                                                    <button type="button" onClick={() => combinarConIA(d)} disabled={combinandoField === d.campo}
                                                        className="text-[10px] font-bold text-violet-600 hover:text-violet-800 disabled:opacity-50 flex items-center gap-1">
                                                        {combinandoField === d.campo ? <><Loader2 className="w-3 h-3 animate-spin" />Sintetizando…</> : <><Sparkles className="w-3 h-3" />Sintetizar</>}
                                                    </button>
                                                </div>
                                                {seleccion[d.campo] === 'combinar' && combinados[d.campo] && (
                                                    <textarea value={combinados[d.campo]}
                                                        onChange={e => setCombinados(c => ({ ...c, [d.campo]: e.target.value }))}
                                                        className="w-full p-2 text-xs bg-white border border-violet-200 rounded-lg resize-none h-20 focus:ring-1 focus:ring-violet-400 outline-none"
                                                        placeholder="Resultado editable…" />
                                                )}
                                                {seleccion[d.campo] !== 'combinar' && !combinados[d.campo] && (
                                                    <p className="text-xs text-slate-400">Haz clic en Sintetizar para que la IA combine ambas versiones.</p>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* JSONB — merge con keys en conflicto */}
                                    {d.tipo === 'jsonb' && (
                                        <div className="p-4 space-y-2">
                                            {d.keys_nuevas && Object.keys(d.keys_nuevas).length > 0 && (
                                                <p className="text-[10px] font-bold text-emerald-600 uppercase">Se agregarán automáticamente: {Object.keys(d.keys_nuevas).join(', ')}</p>
                                            )}
                                            {d.keys_conflicto && Object.keys(d.keys_conflicto).length > 0 && (
                                                <>
                                                    <p className="text-[10px] font-bold text-amber-600 uppercase">En conflicto — elige cuál conservar:</p>
                                                    {Object.entries(d.keys_conflicto).map(([k, vals]) => (
                                                        <div key={k} className="grid grid-cols-2 gap-2">
                                                            <button type="button" onClick={() => setSeleccion(s => ({ ...s, [d.campo]: 'actual' }))}
                                                                className={`p-2 rounded-lg text-xs text-left border ${seleccion[d.campo] === 'actual' ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200'}`}>
                                                                <p className="text-[10px] text-slate-400 font-bold">{k} (actual)</p>
                                                                <p className="text-slate-700">{String((vals as any).actual)}</p>
                                                            </button>
                                                            <button type="button" onClick={() => setSeleccion(s => ({ ...s, [d.campo]: 'nuevo' }))}
                                                                className={`p-2 rounded-lg text-xs text-left border ${seleccion[d.campo] === 'nuevo' ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200'}`}>
                                                                <p className="text-[10px] text-slate-400 font-bold">{k} (nuevo)</p>
                                                                <p className="text-slate-700">{String((vals as any).nuevo)}</p>
                                                            </button>
                                                        </div>
                                                    ))}
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {applyError && <div className="mx-6 mb-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">{applyError}</div>}
                        <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
                            <button type="button" onClick={() => setShowModal(false)}
                                className="flex-1 py-2.5 rounded-xl text-sm border border-slate-200 text-slate-600 hover:bg-slate-50">Cancelar</button>
                            <button type="button" onClick={aplicarSeleccion} disabled={applying}
                                className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center gap-2">
                                {applying ? <><Loader2 className="w-4 h-4 animate-spin" />Aplicando…</> : <><CheckCircle2 className="w-4 h-4" />Aplicar</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
