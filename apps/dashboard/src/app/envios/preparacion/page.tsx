"use client";
import { useCallback, useEffect, useState } from 'react';
import { Page } from '@/components/ui/Page';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Btn } from '@/components/ui/Btn';
import { ArrowLeft, Package } from 'lucide-react';

interface Envio {
    guia: string;
    estado: string;
    count: number;
    cantidad: number;
    fecha: string;
}

interface Salida {
    egreso_id: string;
    articulo_id: string;
    nombre: string | null;
    ubicacion: string | null;
    foto: string | null;
    codigo_ml: string | null;
    cantidad: number;
    edo_reunido: string | null;
    notas: string | null;
}

export default function PreparacionPage() {
    const [envios, setEnvios] = useState<Envio[]>([]);
    const [seleccionado, setSeleccionado] = useState<string | null>(null);
    const [salidas, setSalidas] = useState<Salida[]>([]);
    const [loading, setLoading] = useState(false);
    const [procesando, setProcesando] = useState<string | null>(null);
    const [ficha, setFicha] = useState<Salida | null>(null);
    const [notaTexto, setNotaTexto] = useState('');

    const loadEnvios = useCallback(async () => {
        const r = await fetch('/api/logistica-full/lotes');
        const j = await r.json();
        if (j.success) setEnvios(j.envios || []);
    }, []);

    useEffect(() => { loadEnvios(); }, [loadEnvios]);

    const abrirEnvio = async (guia: string) => {
        setSeleccionado(guia);
        setLoading(true);
        const r = await fetch(`/api/logistica-full/envio?guia=${encodeURIComponent(guia)}`);
        const j = await r.json();
        if (j.success) setSalidas(j.egresos || []);
        setLoading(false);
    };

    const cambiar = async (salida: Salida, accion: 'reunir' | 'preparar' | 'quitar') => {
        setProcesando(salida.egreso_id);
        await fetch('/api/logistica-full/envio', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ egreso_id: salida.egreso_id, accion }),
        });
        setProcesando(null);
        if (seleccionado) await abrirEnvio(seleccionado);
    };

    const editarCantidad = async (salida: Salida, valor: number) => {
        await fetch('/api/logistica-full/envio', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ egreso_id: salida.egreso_id, cantidad: valor }),
        });
        if (seleccionado) await abrirEnvio(seleccionado);
    };

    const abrirFicha = (salida: Salida) => { setFicha(salida); setNotaTexto(''); };

    const guardarNota = async () => {
        if (!ficha || !notaTexto.trim()) return;
        await fetch('/api/logistica-full/envio', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ egreso_id: ficha.egreso_id, notas: notaTexto.trim() }),
        });
        setFicha(null);
        setNotaTexto('');
        if (seleccionado) await abrirEnvio(seleccionado);
    };

    const subirFoto = async (ev: React.ChangeEvent<HTMLInputElement>) => {
        const file = ev.target.files?.[0];
        ev.target.value = '';
        if (!file || !ficha) return;
        const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
        const actuales = (ficha as any).imagenes || [];
        await fetch('/api/logistica-full/envio', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ egreso_id: ficha.egreso_id, imagenes: [...actuales, base64] }),
        });
        if (seleccionado) await abrirEnvio(seleccionado);
    };

    // ---- Pantalla 2: picking de un envío ----
    if (seleccionado) {
        const grupos = new Map<string, Salida[]>();
        for (const s of salidas) {
            const ubi = s.ubicacion || 'Sin ubicación';
            if (!grupos.has(ubi)) grupos.set(ubi, []);
            grupos.get(ubi)!.push(s);
        }
        const total = salidas.length;
        const hechos = salidas.filter(s => s.edo_reunido === 'Reunido' || s.edo_reunido === 'Preparado').length;

        return (
            <Page>
                <div className="flex items-center gap-2">
                    <Btn variant="ghost" size="sm" onClick={() => { setSeleccionado(null); setSalidas([]); }} icon={<ArrowLeft className="w-4 h-4" />}>
                        Envíos
                    </Btn>
                </div>

                <PageHeader
                    title={`Envío ${seleccionado}`}
                    description={`${hechos} / ${total} productos listos`}
                />

                {/* Barra de progreso */}
                <div className="h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--ok)] transition-all" style={{ width: total > 0 ? `${(hechos / total) * 100}%` : '0%' }} />
                </div>

                {loading ? (
                    <div className="py-10 text-center text-[var(--text-faint)]">Cargando…</div>
                ) : (
                    [...grupos.entries()].map(([ubi, items]) => (
                        <div key={ubi}>
                            <div className="px-2 py-1.5 bg-[var(--surface-2)] rounded text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                                📍 {ubi}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
                                {items.map(s => {
                                    const estado = s.edo_reunido === 'Preparado' ? 'Preparado' : s.edo_reunido === 'Reunido' ? 'Reunido' : 'Pendiente';
                                    const completo = estado === 'Preparado';
                                    return (
                                        <div key={s.egreso_id} className={`bg-[var(--surface)] border rounded-xl p-3 ${completo ? 'border-[var(--ok)]/40 opacity-70' : 'border-[var(--border)]'}`}>
                                            <div className="flex gap-3">
                                                {s.foto ? (
                                                    <img src={s.foto} alt="" className="w-16 h-16 rounded-lg object-contain bg-white shrink-0" />
                                                ) : (
                                                    <div className="w-16 h-16 rounded-lg bg-[var(--surface-2)] flex items-center justify-center shrink-0">
                                                        <Package className="w-6 h-6 text-[var(--text-faint)]" />
                                                    </div>
                                                )}
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm font-semibold text-[var(--text)] leading-tight">{s.nombre || s.articulo_id}</p>
                                                    <p className="text-xs text-[var(--text-faint)] font-mono mt-0.5">{s.codigo_ml || '—'}</p>
                                                    {s.notas && <p className="text-xs text-[var(--info)] mt-0.5 break-words">{s.notas}</p>}
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-between mt-3 gap-2">
                                                <Badge tone={completo ? 'success' : estado === 'Reunido' ? 'info' : 'neutral'}>{estado}</Badge>
                                                <div className="flex items-center gap-1">
                                                    <span className="text-xs text-[var(--text-faint)]">salida</span>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        defaultValue={s.cantidad}
                                                        key={`${s.egreso_id}-${s.cantidad}`}
                                                        onBlur={(ev) => {
                                                            const v = Number(ev.target.value);
                                                            if (Number.isFinite(v) && v >= 0 && v !== Number(s.cantidad)) editarCantidad(s, v);
                                                        }}
                                                        className="w-16 px-1.5 py-1 bg-[var(--surface)] border border-[var(--border)] rounded text-sm text-[var(--text)] font-mono text-right"
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex gap-1.5 mt-2">
                                                {estado === 'Pendiente' && (
                                                    <Btn size="sm" variant="outline" className="flex-1" loading={procesando === s.egreso_id} onClick={() => cambiar(s, 'reunir')}>Reunir</Btn>
                                                )}
                                                {estado === 'Reunido' && (
                                                    <Btn size="sm" variant="primary" className="flex-1" loading={procesando === s.egreso_id} onClick={() => cambiar(s, 'preparar')}>Preparar</Btn>
                                                )}
                                                {(estado === 'Reunido' || estado === 'Preparado') && (
                                                    <Btn size="sm" variant="ghost" loading={procesando === s.egreso_id} onClick={() => cambiar(s, 'quitar')}>Quitar</Btn>
                                                )}
                                                <Btn size="sm" variant="ghost" onClick={() => abrirFicha(s)}>Ficha</Btn>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))
                )}

                {/* Ficha de la salida (notas + fotos) */}
                {ficha && (
                    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60" onClick={() => setFicha(null)}>
                        <div className="w-full max-w-md bg-[var(--surface)] rounded-xl border border-[var(--border)] p-4" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-start justify-between">
                                <div>
                                    <h3 className="font-semibold text-[var(--text)]">{ficha.nombre || ficha.articulo_id}</h3>
                                    <p className="text-xs text-[var(--text-faint)] font-mono">{ficha.codigo_ml || '—'}</p>
                                </div>
                                <Btn size="sm" variant="ghost" onClick={() => setFicha(null)}>✕</Btn>
                            </div>

                            <p className="text-xs text-[var(--info)] mt-2 break-words">{ficha.notas}</p>

                            <label className="block mt-3 text-xs text-[var(--text-muted)]">
                                Nota
                                <textarea
                                    value={notaTexto}
                                    onChange={(e) => setNotaTexto(e.target.value)}
                                    placeholder="Ej. Merma, caja dañada, no hay stock…"
                                    className="mt-1 w-full h-20 px-2 py-1.5 bg-[var(--surface-2)] border border-[var(--border)] rounded text-sm text-[var(--text)]"
                                />
                            </label>

                            <div className="flex flex-wrap gap-2 mt-3">
                                <label className="cursor-pointer">
                                    <Btn size="sm" variant="outline" icon={<Package className="w-3.5 h-3.5" />} onClick={() => {}}>📷 Foto</Btn>
                                    <input type="file" accept="image/*" className="hidden" onChange={subirFoto} />
                                </label>
                                <div className="flex-1" />
                                <Btn size="sm" variant="ghost" onClick={() => setFicha(null)}>Cancelar</Btn>
                                <Btn size="sm" variant="primary" onClick={guardarNota} disabled={!notaTexto.trim()}>Guardar nota</Btn>
                            </div>
                        </div>
                    </div>
                )}
            </Page>
        );
    }

    // ---- Pantalla 1: selección de envío ----
    return (
        <Page>
            <PageHeader title="Preparación de Envíos Full" description="Selecciona un envío para empezar a reunir." />
            {envios.length === 0 ? (
                <div className="py-10 text-center text-[var(--text-faint)]">Sin envíos pendientes</div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {envios.map(e => (
                        <button
                            key={e.guia}
                            onClick={() => abrirEnvio(e.guia)}
                            className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 text-left hover:bg-[var(--surface-2)] transition-colors"
                        >
                            <div className="flex items-center justify-between">
                                <span className="font-mono font-bold text-[var(--text)]">Guía {e.guia}</span>
                                <Badge tone={e.estado === 'Preparado' ? 'success' : e.estado === 'Reunido' ? 'info' : 'neutral'}>{e.estado}</Badge>
                            </div>
                            <p className="text-sm text-[var(--text-muted)] mt-1">{e.count} productos · {e.cantidad} piezas</p>
                            <p className="text-xs text-[var(--text-faint)] mt-1">{e.fecha ? new Date(e.fecha).toLocaleDateString('es-MX') : '—'}</p>
                        </button>
                    ))}
                </div>
            )}
        </Page>
    );
}
