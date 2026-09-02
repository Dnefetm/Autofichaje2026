"use client";

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
    ArrowLeft, Package, AlertCircle, Image as ImageIcon,
    ExternalLink, RefreshCw, Box, Tag, Barcode, Globe,
    FileText, XCircle, CheckCircle, Link2, Plus
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { PublishPanel } from '@/components/publish-panel';
import { NewConditionDialog } from '@/components/new-condition-dialog';
import VincularVitrinaModal from '@/components/vincular-vitrina-modal';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

function getPublicImageUrl(rawPath: string | null | undefined): string | null {
    if (!rawPath) return null;
    if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) return rawPath;
    const slashIndex = rawPath.indexOf('/');
    if (slashIndex === -1) return null;
    const bucket = rawPath.substring(0, slashIndex);
    const filePath = rawPath.substring(slashIndex + 1);
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encodeURIComponent(filePath)}`;
}

// Estados de la ficha técnica (asociación artículo ↔ fichas_tecnicas)
const FICHA_ESTADO: Record<string, { label: string; color: string }> = {
    borrador:  { label: 'Borrador',  color: 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]' },
    revision:  { label: 'Revisión',  color: 'bg-[var(--warn)]/10 text-[var(--warn)] border-[var(--warn)]/30' },
    publicado: { label: 'Publicada', color: 'bg-[var(--ok)]/10 text-[var(--ok)] border-[var(--ok)]/30' },
};

function fichaEstadoUI(estado: string | null | undefined) {
    return FICHA_ESTADO[estado || ''] || { label: estado || 'Ficha', color: 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]' };
}

function formatFecha(d: string | null | undefined) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

// -- Página principal ----------------------------------------------------------
export default function ArticuloDetailPage() {
    const params = useParams();
    const id = decodeURIComponent(params.id as string);
    const [product, setProduct] = useState<any>(null);
    const [linkedPubs, setLinkedPubs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [imgError, setImgError] = useState(false);
    const [newConditionPub, setNewConditionPub] = useState<any>(null);
    const [reconcileNote, setReconcileNote] = useState<string | null>(null);
    const [showVincularVitrina, setShowVincularVitrina] = useState(false);

    useEffect(() => {
        if (id) fetchProduct();
    }, [id]);

    async function fetchProduct() {
        setLoading(true);
        setError(null);
        try {
            const { data, error: err } = await supabase
                .from('articulos')
                .select(`
                    *,
                    inventory_snapshot(physical_stock),
                    mapeo_publicacion_articulo(publicacion_id),
                    fichas_tecnicas(id, estado, nombre_producto, created_at)
                `)
                .eq('articulo_id', id)
                .single();

            if (err) {
                setError(err.message);
            } else {
                setProduct(data);
                await loadLinkedPubs(data.articulo_id || id);
            }
        } catch (e: any) {
            setError(e.message || 'Error desconocido');
        } finally {
            setLoading(false);
        }
    }

    // Reconciliar vitrinas enlazadas contra MeLi y devolver solo las que siguen vivas.
    // Detecta "fantasmas" (items eliminados/cerrados en MeLi pero aún activos en BD).
    async function loadLinkedPubs(articuloId: string) {
        setReconcileNote(null);
        try {
            const res = await fetch('/api/publish/reconcile-linked', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ articulo_id: articuloId }),
            });
            if (!res.ok) {
                setLinkedPubs([]);
                return;
            }
            const data = await res.json();
            if (data?.ok) {
                setLinkedPubs(Array.isArray(data.pubs) ? data.pubs : []);
                if (data.ocultadas > 0) {
                    setReconcileNote(`${data.ocultadas} publicación(es) eliminada(s) en Mercado Libre se ocultaron de esta lista.`);
                }
            } else {
                setLinkedPubs([]);
            }
        } catch {
            setLinkedPubs([]);
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-32">
                <RefreshCw className="w-8 h-8 animate-spin text-[var(--accent)]" />
            </div>
        );
    }

    if (error || !product) {
        return (
            <div className="space-y-6">
                <Link href="/catalog" className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
                    <ArrowLeft className="w-4 h-4" /> Volver al catálogo
                </Link>
                <div className="py-20 text-center bg-[var(--err)]/10 rounded-[var(--radius)] border border-[var(--err)]/30">
                    <AlertCircle className="w-10 h-10 text-[var(--err)] mx-auto mb-3" />
                    <h3 className="text-lg font-bold text-[var(--text)]">Error al cargar artículo</h3>
                    <p className="text-[var(--err)] mt-1">{error || 'Artículo no encontrado'}</p>
                </div>
            </div>
        );
    }

    const snapshot = Array.isArray(product.inventory_snapshot) ? product.inventory_snapshot[0] : product.inventory_snapshot;
    const stock = snapshot?.physical_stock ?? 0;
    const isLowStock = stock <= 2;
    const isMapped = linkedPubs.length > 0;
    const fichas = Array.isArray(product.fichas_tecnicas) ? product.fichas_tecnicas : [];
    const rawImage = product.imagenes?.[0] || null;
    const image = getPublicImageUrl(rawImage);

    const fields = [
        { label: 'SKU / Artículo ID', value: product.articulo_id, icon: Tag },
        { label: 'Nombre', value: product.nombre, icon: FileText },
        { label: 'Marca', value: product.marca, icon: Box },
        { label: 'Modelo', value: product.modelo, icon: Package },
        { label: 'Variante', value: product.variante, icon: Tag },
        { label: 'Categoría', value: product.categoria, icon: Tag },
        { label: 'Código Universal (UPC/EAN)', value: product.codigo_universal, icon: Barcode },
        { label: 'Código SAT', value: product.codigo_sat, icon: Barcode },
        { label: 'Caja Madre', value: product.caja_madre, icon: Box },
        { label: 'País de Origen', value: product.pais_origen, icon: Globe },
        { label: 'Peso (kg)', value: product.peso_kg, icon: Box },
        { label: 'Materiales', value: product.materiales, icon: Box },
        { label: 'Descripción', value: product.descripcion, icon: FileText },
        { label: 'Notas', value: product.notas, icon: FileText },
        { label: 'URL Producto', value: product.url_producto, icon: ExternalLink, isLink: true },
        { label: 'URL Video', value: product.url_video, icon: ExternalLink, isLink: true },
        { label: 'Publicación ML', value: product.publicacion_ml, icon: ExternalLink, isLink: true },
    ];

    const boolFields = [
        { label: 'Es Full', value: product.es_full },
        { label: 'Es Dropshipping', value: product.es_dropshipping },
        { label: 'Es Obsoleto', value: product.es_obsoleto },
        { label: 'Activo', value: product.activo },
        { label: 'Requiere Etiqueta Nombre', value: product.requiere_etiqueta_nombre },
        { label: 'Requiere Embalaje Especial', value: product.requiere_embalaje_esp },
    ];

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex items-center justify-between">
                <Link href="/catalog" className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors font-medium">
                    <ArrowLeft className="w-4 h-4" /> Volver al catálogo
                </Link>
                <button onClick={fetchProduct} className="p-2 text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors" title="Refrescar">
                    <RefreshCw className="w-5 h-5" />
                </button>
            </div>

            {/* Header */}
            <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] shadow-sm overflow-hidden">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
                    {/* Image */}
                    <div className="aspect-square bg-[var(--surface-2)] flex items-center justify-center md:border-r border-[var(--border)]">
                        {image && !imgError ? (
                            <img src={image} alt={product.nombre} className="w-full h-full object-contain p-4" onError={() => setImgError(true)} />
                        ) : (
                            <div className="flex flex-col items-center justify-center text-[var(--text-faint)] gap-2">
                                <ImageIcon className="w-16 h-16 opacity-40" />
                                <span className="text-sm font-medium">Sin Imagen</span>
                            </div>
                        )}
                    </div>

                    {/* Main Info */}
                    <div className="col-span-2 p-6 flex flex-col gap-4">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <div className="flex items-center gap-2">
                                    <p className="text-xs font-mono font-bold text-[var(--text-faint)] uppercase tracking-wider">{product.marca || 'GENERIC'}</p>
                                    <span className="text-[9px] uppercase tracking-wider text-[var(--text-faint)] opacity-70">AppSheet</span>
                                </div>
                                <h1 className="text-xl font-bold text-[var(--text)] mt-1">{product.nombre}</h1>
                                <p className="text-sm text-[var(--text-muted)] font-mono mt-1">{product.articulo_id}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                {isMapped ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold border bg-[var(--ok)]/10 text-[var(--ok)] border-[var(--ok)]/30">
                                        <Link2 className="w-3 h-3" /> {linkedPubs.length} publ.
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold border bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]">
                                        Sin vincular
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Stock Card */}
                        <div className={cn(
                            "p-4 rounded-[var(--radius-sm)] border flex items-center justify-between",
                            isLowStock ? "bg-[var(--err)]/10 border-[var(--err)]/30" : "bg-[var(--ok)]/10 border-[var(--ok)]/30"
                        )}>
                            <div className="flex items-center gap-2">
                                {isLowStock && <AlertCircle className="w-4 h-4 text-[var(--err)]" />}
                                <span className="text-sm font-bold uppercase text-[var(--text-muted)]">Stock Físico</span>
                            </div>
                            <span className={cn("text-3xl font-black tabular-nums", isLowStock ? "text-[var(--err)]" : "text-[var(--ok)]")}>
                                {stock}
                            </span>
                        </div>

                        {/* Boolean Flags */}
                        <div className="flex flex-wrap gap-2">
                            {boolFields.map(f => f.value != null && (
                                <span key={f.label} className={cn(
                                    "text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 border",
                                    f.value
                                        ? "bg-[var(--ok)]/10 text-[var(--ok)] border-[var(--ok)]/30"
                                        : "bg-[var(--surface-2)] text-[var(--text-faint)] border-[var(--border)]"
                                )}>
                                    {f.value ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                    {f.label}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Ficha técnica asociada */}
            <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <FileText className="w-4 h-4 text-[var(--accent)]" />
                        <h2 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">Ficha técnica</h2>
                        <span className="text-[10px] text-[var(--text-faint)] tabular-nums">{fichas.length}</span>
                    </div>
                    <Link
                        href={`/autoficha?articulo_id=${encodeURIComponent(product.articulo_id || id)}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold text-[var(--accent)] bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded-[var(--radius-sm)] hover:bg-[var(--accent)]/20 transition-colors"
                    >
                        <Plus className="w-3.5 h-3.5" /> Crear ficha técnica
                    </Link>
                </div>

                {fichas.length === 0 ? (
                    <div className="p-8 text-center text-[var(--text-faint)]">
                        <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">Este artículo aún no tiene ficha técnica.</p>
                        <p className="text-xs mt-1">Créala con IA para asociarla a este producto.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-[var(--border)]">
                        {fichas.map((f: any, i: number) => {
                            const ui = fichaEstadoUI(f.estado);
                            return (
                                <div key={f.id || i} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--bg)] transition-colors">
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-[var(--text)] truncate">{f.nombre_producto || product.nombre}</p>
                                        <p className="text-[10px] font-mono text-[var(--text-faint)] mt-0.5">Creada {formatFecha(f.created_at)}</p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border", ui.color)}>
                                            {ui.label}
                                        </span>
                                        <Link
                                            href={`/fichas/${f.id}`}
                                            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] hover:underline"
                                        >
                                            Ver <ExternalLink className="w-3 h-3" />
                                        </Link>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Detail Fields */}
            <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] shadow-sm p-6">
                <h2 className="text-lg font-bold text-[var(--text)] mb-4">Datos del Artículo</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {fields.map(f => f.value != null && f.value !== '' && (
                        <div key={f.label} className="flex items-start gap-3 p-3 bg-[var(--surface-2)] rounded-[var(--radius-sm)]">
                            <f.icon className="w-4 h-4 text-[var(--text-faint)] mt-0.5 shrink-0" />
                            <div className="min-w-0">
                                <p className="text-[10px] font-bold uppercase text-[var(--text-faint)] tracking-wider">{f.label}</p>
                                {f.isLink ? (
                                    <a href={f.value} target="_blank" rel="noopener noreferrer" className="text-sm text-[var(--accent)] hover:underline break-all">{f.value}</a>
                                ) : (
                                    <p className="text-sm text-[var(--text-muted)] break-words">{f.value}</p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* -- Aviso Transición a Motor V2 ----------------------------------- */}
            <div className="bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded-[var(--radius)] p-6">
                <div className="flex gap-3">
                    <AlertCircle className="w-6 h-6 text-[var(--accent)] shrink-0" />
                    <div>
                        <h3 className="font-bold text-[var(--text)] text-lg">La gestión de precios ha migrado (Motor V2)</h3>
                        <p className="text-[var(--text-muted)] text-sm mt-1">
                            Para evitar errores matemáticos en los bundles y permitir márgenes dinámicos por categoría, los precios ya no se administran aquí a nivel de SKU base.
                        </p>
                        <p className="text-[var(--text-muted)] text-sm mt-2 font-semibold">
                            ¿Dónde configuro mis precios ahora?
                        </p>
                        <p className="text-[var(--text-muted)] text-sm mt-1">
                            Abre cualquiera de las publicaciones de Mercado Libre vinculadas (abajo) para ver la nueva <strong>Tarjeta de Auditoría Matemática</strong>, donde podrás ver el desglose exacto de comisiones y fijar precios manuales.
                        </p>
                    </div>
                </div>
            </div>

            {/* -- Panel de Publicación --------------------------------------- */}
            <PublishPanel
                articulo_id={product.articulo_id || id}
                nombreArticulo={product.nombre || ''}
                imagenesBase={Array.isArray(product.imagenes) ? product.imagenes : []}
                codigoUniversal={product.codigo_universal || ''}
            />

            {/* Publicaciones / Vitrinas enlazadas */}
            <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between gap-2">
                    <h2 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">Publicaciones / Vitrinas enlazadas</h2>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-[var(--text-faint)] tabular-nums">{linkedPubs.length}</span>
                        <button
                            onClick={() => setShowVincularVitrina(true)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-[var(--accent-ink)] bg-[var(--accent)] rounded-[var(--radius-sm)] hover:brightness-110"
                        >
                            <Link2 className="w-3.5 h-3.5" /> Vincular a vidriera
                        </button>
                    </div>
                </div>
                {reconcileNote && (
                    <div className="px-5 py-2 text-[11px] text-[var(--warn)] bg-[var(--warn)]/10 border-b border-[var(--warn)]/30">
                        {reconcileNote}
                    </div>
                )}
                {linkedPubs.length === 0 ? (
                    <div className="p-6 text-center text-[var(--text-faint)]">
                        <p className="text-sm">Este artículo no tiene publicaciones enlazadas.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-[var(--border)]">
                        {linkedPubs.map((p: any) => {
                            const tipoLabel = ({ tradicional: 'Tradicional', catalogo: 'Catálogo', catalogo_derivada: 'Cat. Derivada', up: 'User Product' } as any)[p.tipo_publicacion] || p.tipo_publicacion || '—';
                            const listingLabel = ({ gold_special: 'Clásica', gold_pro: 'Premium', free: 'Gratuita', silver: 'Silver' } as any)[p.listing_type_id] || p.listing_type_id || '—';
                            const statusLabel = ({ active: 'Activa', paused: 'Pausada', under_review: 'En revisión', closed: 'Cerrada' } as any)[p.status_externo] || p.status_externo || '—';
                            const statusTone = p.status_externo === 'active'
                                ? 'bg-[var(--ok)]/10 text-[var(--ok)] border-[var(--ok)]/30'
                                : p.status_externo === 'paused'
                                    ? 'bg-[var(--warn)]/10 text-[var(--warn)] border-[var(--warn)]/30'
                                    : 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]';
                            return (
                                <div key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm font-semibold text-[var(--text)] truncate">{p.titulo || p.external_item_id}</span>
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]">{tipoLabel}</span>
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]">{listingLabel}</span>
                                            <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border", statusTone)}>{statusLabel}</span>
                                        </div>
                                        <p className="text-[11px] text-[var(--text-faint)] mt-1 font-mono">
                                            {p.account_name || '—'} · {p.external_item_id}
                                        </p>
                                    </div>
                                    <div className="shrink-0 flex items-center gap-3">
                                        <div className="text-right">
                                            <p className="text-sm font-bold text-[var(--text)] tabular-nums">${Number(p.precio_venta || 0).toLocaleString('es-MX')}</p>
                                            <p className="text-[11px] text-[var(--text-muted)]">
                                                stock {p.stock_publicado ?? '—'} · {p.free_shipping ? 'Envío incluido' : 'Sin envío gratis'}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => setNewConditionPub(p)}
                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-[var(--accent)] bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded-[var(--radius-sm)] hover:bg-[var(--accent)]/20 transition-colors whitespace-nowrap"
                                            title="Crear otra condición de venta (Clásica ↔ Premium) con el mismo producto"
                                        >
                                            <Plus className="w-3 h-3" /> Condición
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Timestamps */}
            <div className="text-xs text-[var(--text-faint)] text-right">
                Creado: {product.creado_el ? new Date(product.creado_el).toLocaleString('es-MX') : 'N/A'}
            </div>

            {/* Modal: nueva condición de venta */}
            {newConditionPub && (
                <NewConditionDialog
                    accountId={newConditionPub.marketplace_id}
                    itemId={newConditionPub.external_item_id}
                    itemTitle={newConditionPub.titulo || newConditionPub.external_item_id}
                    currentListingType={newConditionPub.listing_type_id}
                    currentFreeShipping={!!newConditionPub.free_shipping}
                    currentPrice={Number(newConditionPub.precio_venta || 0)}
                    articuloId={product.articulo_id || id}
                    onClose={() => setNewConditionPub(null)}
                    onDone={() => { setNewConditionPub(null); fetchProduct(); }}
                />
            )}

            {/* Modal: vincular a vidriera existente */}
            {showVincularVitrina && (
                <VincularVitrinaModal
                    articuloId={product.articulo_id || id}
                    articuloNombre={product.nombre || ''}
                    onClose={() => setShowVincularVitrina(false)}
                    onSuccess={() => { setShowVincularVitrina(false); fetchProduct(); }}
                />
            )}
        </div>
    );
}
