"use client";

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
    ArrowLeft, Package, AlertCircle, Image as ImageIcon,
    ExternalLink, RefreshCw, Box, Tag, Barcode, Globe,
    FileText, XCircle, CheckCircle
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { PublishPanel } from '@/components/publish-panel';

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



// -- Página principal ----------------------------------------------------------
export default function ArticuloDetailPage() {
    const params = useParams();
    const id = decodeURIComponent(params.id as string);
    const [product, setProduct] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [imgError, setImgError] = useState(false);

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
                    mapeo_publicacion_articulo(publicacion_id)
                `)
                .eq('articulo_id', id)
                .single();

            if (err) {
                setError(err.message);
            } else {
                setProduct(data);
            }
        } catch (e: any) {
            setError(e.message || 'Error desconocido');
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-32">
                <RefreshCw className="w-8 h-8 animate-spin text-indigo-300" />
            </div>
        );
    }

    if (error || !product) {
        return (
            <div className="space-y-6">
                <Link href="/catalog" className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
                    <ArrowLeft className="w-4 h-4" /> Volver al catálogo
                </Link>
                <div className="py-20 text-center bg-[var(--err)]/10 rounded-xl border border-[var(--err)]/30">
                    <AlertCircle className="w-10 h-10 text-rose-400 mx-auto mb-3" />
                    <h3 className="text-lg font-bold text-rose-900">Error al cargar artículo</h3>
                    <p className="text-[var(--err)] mt-1">{error || 'Artículo no encontrado'}</p>
                </div>
            </div>
        );
    }

    const snapshot = Array.isArray(product.inventory_snapshot) ? product.inventory_snapshot[0] : product.inventory_snapshot;
    const stock = snapshot?.physical_stock ?? 0;
    const isLowStock = stock <= 2;
    const isMapped = Array.isArray(product.mapeo_publicacion_articulo) ? product.mapeo_publicacion_articulo.length > 0 : !!product.mapeo_publicacion_articulo;
    const rawImage = product.imagenes?.[0] || null;
    const image = getPublicImageUrl(rawImage);

    const fields = [
        { label: 'SKU / Artículo ID', value: product.articulo_id, icon: Tag },
        { label: 'Nombre', value: product.nombre, icon: FileText },
        { label: 'Marca', value: product.marca, icon: Box },
        { label: 'Modelo', value: product.modelo, icon: Package },
        { label: 'Variante', value: product.variante, icon: Tag },
        { label: 'Código Universal (UPC/EAN)', value: product.codigo_universal, icon: Barcode },
        { label: 'Código SAT', value: product.codigo_sat, icon: Barcode },
        { label: 'Caja Madre', value: product.caja_madre, icon: Box },
        { label: 'País de Origen', value: product.pais_origen, icon: Globe },
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
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-sm overflow-hidden">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
                    {/* Image */}
                    <div className="aspect-square bg-[var(--bg)] flex items-center justify-center md:border-r border-[var(--border)]">
                        {image && !imgError ? (
                            <img src={image} alt={product.nombre} className="w-full h-full object-contain p-4" onError={() => setImgError(true)} />
                        ) : (
                            <div className="flex flex-col items-center justify-center text-slate-300 gap-2">
                                <ImageIcon className="w-16 h-16 opacity-40" />
                                <span className="text-sm font-medium">Sin Imagen</span>
                            </div>
                        )}
                    </div>

                    {/* Main Info */}
                    <div className="col-span-2 p-6 flex flex-col gap-4">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-xs font-mono font-bold text-[var(--text-faint)] uppercase tracking-wider">{product.marca || 'GENERIC'}</p>
                                <h1 className="text-xl font-bold text-[var(--text)] mt-1">{product.nombre}</h1>
                                <p className="text-sm text-[var(--text-muted)] font-mono mt-1">{product.articulo_id}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                {isMapped ? (
                                    <span className="text-xs bg-yellow-400 text-yellow-900 font-bold px-3 py-1 rounded-md">MeLi</span>
                                ) : (
                                    <span className="text-xs bg-[var(--surface)] text-[var(--accent-ink)] font-bold px-3 py-1 rounded-md">Sin vincular</span>
                                )}
                            </div>
                        </div>

                        {/* Stock Card */}
                        <div className={cn(
                            "p-4 rounded-lg border flex items-center justify-between",
                            isLowStock ? "bg-[var(--err)]/10 border-[var(--err)]/30" : "bg-[var(--ok)]/10 border-[var(--ok)]/30"
                        )}>
                            <div className="flex items-center gap-2">
                                {isLowStock && <AlertCircle className="w-4 h-4 text-[var(--err)]" />}
                                <span className="text-sm font-bold uppercase text-[var(--text-muted)]">Stock Físico</span>
                            </div>
                            <span className={cn("text-3xl font-black", isLowStock ? "text-[var(--err)]" : "text-[var(--ok)]")}>
                                {stock}
                            </span>
                        </div>

                        {/* Boolean Flags */}
                        <div className="flex flex-wrap gap-2">
                            {boolFields.map(f => f.value != null && (
                                <span key={f.label} className={cn(
                                    "text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1",
                                    f.value ? "bg-emerald-100 text-[var(--ok)]" : "bg-[var(--surface-2)] text-[var(--text-faint)]"
                                )}>
                                    {f.value ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                    {f.label}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Detail Fields */}
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-sm p-6">
                <h2 className="text-lg font-bold text-[var(--text)] mb-4">Datos del Artículo</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {fields.map(f => f.value && (
                        <div key={f.label} className="flex items-start gap-3 p-3 bg-[var(--bg)] rounded-lg">
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
            <div className="bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded-xl p-6">
                <div className="flex gap-3">
                    <AlertCircle className="w-6 h-6 text-[var(--accent)] shrink-0" />
                    <div>
                        <h3 className="font-bold text-indigo-900 text-lg">La gestión de precios ha migrado (Motor V2)</h3>
                        <p className="text-indigo-800 text-sm mt-1">
                            Para evitar errores matemáticos en los bundles y permitir márgenes dinámicos por categoría, los precios ya no se administran aquí a nivel de SKU base.
                        </p>
                        <p className="text-indigo-800 text-sm mt-2 font-semibold">
                            ¿Dónde configuro mis precios ahora?
                        </p>
                        <p className="text-indigo-800 text-sm mt-1">
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
            />

            {/* Marketplace Mappings */}
            {isMapped && (
                <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-sm p-6">
                    <h2 className="text-lg font-bold text-[var(--text)] mb-4">Mapeos de Marketplace</h2>
                    <div className="flex flex-wrap gap-2">
                        {(Array.isArray(product.mapeo_publicacion_articulo) ? product.mapeo_publicacion_articulo : [product.mapeo_publicacion_articulo]).map((m: any, i: number) => (
                            <span key={i} className="text-xs bg-yellow-100 text-yellow-800 font-mono font-bold px-3 py-1.5 rounded-lg border border-yellow-200">
                                {m.publicacion_id}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Timestamps */}
            <div className="text-xs text-[var(--text-faint)] text-right">
                Creado: {product.creado_el ? new Date(product.creado_el).toLocaleString('es-MX') : 'N/A'}
            </div>
        </div>
    );
}
