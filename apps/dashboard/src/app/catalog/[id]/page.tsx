"use client";

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Package, TrendingUp, AlertCircle, Image as ImageIcon, ExternalLink, RefreshCw, Edit2, Save, Box, Tag, Barcode, Globe, FileText, CheckCircle, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

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

export default function ArticuloDetailPage() {
    const params = useParams();
    const id = params.id as string;
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
                <Link href="/catalog" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-indigo-600 transition-colors">
                    <ArrowLeft className="w-4 h-4" /> Volver al catálogo
                </Link>
                <div className="py-20 text-center bg-rose-50 rounded-xl border border-rose-200">
                    <AlertCircle className="w-10 h-10 text-rose-400 mx-auto mb-3" />
                    <h3 className="text-lg font-bold text-rose-900">Error al cargar artículo</h3>
                    <p className="text-rose-500 mt-1">{error || 'Artículo no encontrado'}</p>
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
                <Link href="/catalog" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-indigo-600 transition-colors font-medium">
                    <ArrowLeft className="w-4 h-4" /> Volver al catálogo
                </Link>
                <button onClick={fetchProduct} className="p-2 text-slate-400 hover:text-indigo-600 transition-colors" title="Refrescar">
                    <RefreshCw className="w-5 h-5" />
                </button>
            </div>

            {/* Header */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
                    {/* Image */}
                    <div className="aspect-square bg-gray-50 flex items-center justify-center md:border-r border-slate-100">
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
                                <p className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">{product.marca || 'GENERIC'}</p>
                                <h1 className="text-xl font-bold text-slate-900 mt-1">{product.nombre}</h1>
                                <p className="text-sm text-slate-500 font-mono mt-1">{product.articulo_id}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                {isMapped ? (
                                    <span className="text-xs bg-yellow-400 text-yellow-900 font-bold px-3 py-1 rounded-md">MeLi</span>
                                ) : (
                                    <span className="text-xs bg-slate-800 text-white font-bold px-3 py-1 rounded-md">Sin vincular</span>
                                )}
                            </div>
                        </div>

                        {/* Stock Card */}
                        <div className={cn(
                            "p-4 rounded-lg border flex items-center justify-between",
                            isLowStock ? "bg-rose-50 border-rose-200" : "bg-emerald-50 border-emerald-200"
                        )}>
                            <div className="flex items-center gap-2">
                                {isLowStock && <AlertCircle className="w-4 h-4 text-rose-500" />}
                                <span className="text-sm font-bold uppercase text-slate-600">Stock Físico</span>
                            </div>
                            <span className={cn("text-3xl font-black", isLowStock ? "text-rose-600" : "text-emerald-600")}>
                                {stock}
                            </span>
                        </div>

                        {/* Boolean Flags */}
                        <div className="flex flex-wrap gap-2">
                            {boolFields.map(f => f.value != null && (
                                <span key={f.label} className={cn(
                                    "text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1",
                                    f.value ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"
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
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <h2 className="text-lg font-bold text-slate-900 mb-4">Datos del Artículo</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {fields.map(f => f.value && (
                        <div key={f.label} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                            <f.icon className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                            <div className="min-w-0">
                                <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">{f.label}</p>
                                {f.isLink ? (
                                    <a href={f.value} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-600 hover:underline break-all">{f.value}</a>
                                ) : (
                                    <p className="text-sm text-slate-700 break-words">{f.value}</p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Marketplace Mappings */}
            {isMapped && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">Mapeos de Marketplace</h2>
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
            <div className="text-xs text-slate-400 text-right">
                Creado: {product.creado_el ? new Date(product.creado_el).toLocaleString('es-MX') : 'N/A'}
            </div>
        </div>
    );
}
