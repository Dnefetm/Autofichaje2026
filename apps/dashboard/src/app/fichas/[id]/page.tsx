"use client";

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, AlertCircle, FileText, Link2, CheckCircle2, ExternalLink, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Estado = 'borrador' | 'revision' | 'publicada';

interface FichaDetalle {
    id: string; estado: string; nombre_producto: string;
    descripcion?: string; articulo_id?: string; created_at: string;
    articulos?: { articulo_id: string; nombre: string; marca: string; modelo?: string; variante?: string; codigo_universal?: string } | null;
    ficha_extracciones?: Array<{ id: string; extraccion_cruda: any; aplicada_a_ficha: boolean; created_at: string }>;
}

function EstadoBadge({ estado }: { estado: string }) {
    const map: Record<string, string> = {
        borrador:  'bg-slate-100 text-slate-600',
        revision:  'bg-amber-100 text-amber-700',
        publicada: 'bg-emerald-100 text-emerald-700',
    };
    return <span className={`text-xs font-bold px-3 py-1 rounded-full capitalize ${map[estado] || 'bg-slate-100 text-slate-500'}`}>{estado}</span>;
}

const ESTADOS: Estado[] = ['borrador', 'revision', 'publicada'];

export default function FichaDetallePage() {
    const { id }    = useParams<{ id: string }>();
    const router    = useRouter();
    const [ficha, setFicha]       = useState<FichaDetalle | null>(null);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState('');
    const [saving, setSaving]     = useState(false);
    const [savedOk, setSavedOk]   = useState(false);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        if (!id) return;
        (async () => {
            setLoading(true);
            const { data, error } = await supabase
                .from('fichas_tecnicas')
                .select(`
                    id, estado, nombre_producto, descripcion, articulo_id, created_at,
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

    async function cambiarEstado(nuevoEstado: Estado) {
        if (!ficha) return;
        setSaving(true);
        const { error } = await supabase
            .from('fichas_tecnicas')
            .update({ estado: nuevoEstado })
            .eq('id', ficha.id);
        if (!error) { setFicha(p => p ? { ...p, estado: nuevoEstado } : p); setSavedOk(true); setTimeout(() => setSavedOk(false), 2000); }
        setSaving(false);
    }

    async function eliminarFicha() {
        if (!ficha) return;
        if (!window.confirm(`¿Eliminar la ficha "${ficha.nombre_producto || 'sin nombre'}"?\nEsta acción no se puede deshacer.`)) return;
        setDeleting(true);
        try {
            const res = await fetch(`/api/fichas/${ficha.id}`, { method: 'DELETE' });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(body?.error || 'Error al eliminar la ficha.');
                setDeleting(false);
                return;
            }
            router.push('/fichas');
        } catch (err: any) {
            setError(err?.message || 'Error de red al eliminar.');
            setDeleting(false);
        }
    }

    if (loading) return <div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando ficha…</div>;
    if (error)   return <div className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700"><AlertCircle className="w-5 h-5 shrink-0" /><p>{error}</p></div>;
    if (!ficha)  return null;

    const art = ficha.articulos;

    return (
        <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center gap-4">
                <button onClick={() => router.back()} className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-400">
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex-1">
                    <h2 className="text-2xl font-bold tracking-tight">{ficha.nombre_producto || 'Ficha sin nombre'}</h2>
                    <p className="text-slate-400 text-xs font-mono mt-0.5">{ficha.id}</p>
                </div>
                <EstadoBadge estado={ficha.estado} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Columna principal */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Detalle de la ficha */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
                        <h3 className="text-base font-bold flex items-center gap-2"><FileText className="w-4 h-4 text-indigo-500" /> Datos de la ficha</h3>
                        {ficha.descripcion && (
                            <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Descripción</p>
                                <p className="text-sm text-slate-600 leading-relaxed">{ficha.descripcion}</p>
                            </div>
                        )}
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Creada</p>
                            <p className="text-sm text-slate-600">{new Date(ficha.created_at).toLocaleString('es-MX')}</p>
                        </div>
                    </div>

                    {/* Artículo vinculado */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
                        <h3 className="text-base font-bold flex items-center gap-2"><Link2 className="w-4 h-4 text-indigo-500" /> Artículo del catálogo</h3>
                        {art ? (
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">SKU</p><p className="font-mono text-slate-700">{art.articulo_id}</p></div>
                                <div><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Nombre</p><p className="text-slate-700">{art.nombre}</p></div>
                                <div><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Marca</p><p className="text-slate-700">{art.marca}</p></div>
                                {art.modelo && <div><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Modelo</p><p className="text-slate-700">{art.modelo}</p></div>}
                                {art.variante && <div><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Variante</p><p className="text-slate-700">{art.variante}</p></div>}
                                {art.codigo_universal && <div><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">EAN</p><p className="font-mono text-slate-700">{art.codigo_universal}</p></div>}
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

                {/* Sidebar de acciones */}
                <div className="space-y-4">
                    {/* Cambiar estado */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
                        <h3 className="text-sm font-bold">Cambiar estado</h3>
                        <div className="space-y-2">
                            {ESTADOS.map(e => (
                                <button key={e} onClick={() => cambiarEstado(e)} disabled={saving || ficha.estado === e}
                                    className={`w-full py-2.5 px-4 rounded-xl text-sm font-semibold border transition-colors ${ficha.estado === e ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`}>
                                    {e === 'borrador' ? '📝 Borrador' : e === 'revision' ? '🔍 En revisión' : '✅ Publicada'}
                                </button>
                            ))}
                        </div>
                        {savedOk && <p className="text-xs text-emerald-600 font-semibold text-center">✓ Estado actualizado</p>}
                    </div>

                    {/* Acciones rápidas */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
                        <h3 className="text-sm font-bold">Acciones</h3>
                        <Link href="/fichas" className="block w-full py-2.5 px-4 rounded-xl text-sm font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 text-center transition-colors">
                            ← Volver al listado
                        </Link>
                        <Link href="/autoficha" className="block w-full py-2.5 px-4 rounded-xl text-sm font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 text-center transition-colors">
                            Nueva ficha con IA
                        </Link>
                        {ficha.estado !== 'publicada' && (
                            <button
                                type="button"
                                onClick={eliminarFicha}
                                disabled={deleting}
                                className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                                {deleting
                                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Eliminando…</>
                                    : <><Trash2 className="w-4 h-4" /> Eliminar ficha</>}
                            </button>
                        )}
                        {ficha.estado === 'publicada' && (
                            <p className="text-xs text-slate-400 text-center">Las fichas publicadas no se pueden eliminar directamente. Cámbiala a borrador primero.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
