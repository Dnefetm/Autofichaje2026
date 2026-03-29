import React, { useState } from 'react';
import { Package, TrendingUp, AlertCircle, Save, Edit2, Image as ImageIcon, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { dashboardService } from '@/lib/dashboard-service';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

/**
 * Convierte un path relativo de Storage (ej: "Articulos_Images/file.jpg")
 * a una URL publica completa de Supabase Storage.
 * Si ya es una URL completa (http/https), la retorna tal cual.
 */
function getPublicImageUrl(rawPath: string | null | undefined): string | null {
    if (!rawPath) return null;
    // Si ya es URL completa, retornar tal cual
    if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) return rawPath;
    // Path relativo: "Bucket/file.jpg" -> URL publica
    // El primer segmento es el bucket name
    const slashIndex = rawPath.indexOf('/');
    if (slashIndex === -1) return null;
    const bucket = rawPath.substring(0, slashIndex);
    const filePath = rawPath.substring(slashIndex + 1);
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encodeURIComponent(filePath)}`;
}

export function SkuCard({
    product,
    onStockUpdate,
    isSelected = false,
    onToggleSelection
}: {
    product: any,
    onStockUpdate: (sku: string, newStock: number) => void,
    isSelected?: boolean,
    onToggleSelection?: (sku: string) => void
}) {
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [imgError, setImgError] = useState(false);

    // Safety check arrays vs objects for inventory
    const snapshot = Array.isArray(product.inventory_snapshot) ? product.inventory_snapshot[0] : product.inventory_snapshot;
            const currentStock = snapshot?.physical_stock ?? 0;

    // String state permite al usuario borrar el campo completamente (input controlado)
    const [stockInput, setStockInput] = useState<string>(String(currentStock));
    const parsedInput = parseInt(stockInput, 10);
    const newStock = isNaN(parsedInput) ? 0 : Math.max(0, parsedInput);

    const rawImage = product.imagenes?.[0] || null;
    const image = getPublicImageUrl(rawImage);

    const isMapped = Array.isArray(product.mapeo_publicacion_articulo)
        ? product.mapeo_publicacion_articulo.length > 0
        : !!product.mapeo_publicacion_articulo;

    const isLowStock = newStock <= 2;

    const handleSave = async () => {
        setSaving(true);
        try {
            await dashboardService.triggerStockUpdate(product.articulo_id, newStock, undefined);
            onStockUpdate(product.articulo_id, newStock);
            setStockInput(String(newStock)); // sincronizar input string tras guardar
            setEditing(false);
        } catch (err) {
            alert('Error al intentar actualizar el stock');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            className={cn(
                "bg-white rounded-xl border overflow-hidden flex flex-col group hover:shadow-md transition-all",
                isSelected
                    ? "border-indigo-400 ring-2 ring-indigo-400 shadow-md"
                    : "border-slate-200 shadow-sm"
            )}
        >
            {/* Image Section */}
            <div
                className="aspect-square bg-gray-50/80 flex items-center justify-center relative overflow-hidden cursor-pointer"
                onClick={() => onToggleSelection?.(product.articulo_id)}
            >
                {image && !imgError ? (
                    <img
                        src={image}
                        alt={product.nombre}
                        className="w-full h-full object-contain"
                        onError={() => setImgError(true)}
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center text-slate-300 gap-2">
                        <ImageIcon className="w-12 h-12 opacity-50" />
                        <span className="text-xs font-medium">Sin Imagen</span>
                    </div>
                )}

                {/* Checkbox - top right */}
                <div className="absolute top-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelection?.(product.articulo_id)}
                        className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer pointer-events-auto"
                    />
                </div>

                {/* MeLi / Desvinculado badge - top left */}
                <div className="absolute top-2 left-2 pointer-events-none">
                    {isMapped ? (
                        <span className="text-xs bg-yellow-400 text-yellow-900 font-bold px-2 py-0.5 rounded-md shadow-sm">
                            MeLi
                        </span>
                    ) : (
                        <span className="text-xs bg-slate-800 text-white font-bold px-2 py-0.5 rounded-md shadow-sm">
                            Sin vincular
                        </span>
                    )}
                </div>
            </div>

            {/* Content Section */}
            <div className="p-3 flex flex-col gap-1 flex-1">
                <p className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                    {product.marca || 'GENERIC'}
                </p>
                <h3 className="text-sm font-bold text-slate-900 leading-snug line-clamp-2">
                    {product.nombre}
                </h3>

                {/* Identifiers */}
                <div className="mt-1 flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                        <span className="text-[9px] font-bold uppercase text-slate-400 w-16 shrink-0">SKU</span>
                        <span className="text-[10px] font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded truncate">
                            {product.articulo_id}
                        </span>
                    </div>
                    {product.modelo && (
                        <div className="flex items-center gap-2">
                            <span className="text-[9px] font-bold uppercase text-slate-400 w-16 shrink-0">Modelo</span>
                            <span className="text-[10px] text-slate-600 truncate">{product.modelo}</span>
                        </div>
                    )}
                    {product.codigo_universal && (
                        <div className="flex items-center gap-2">
                            <span className="text-[9px] font-bold uppercase text-slate-400 w-16 shrink-0">UPC/EAN</span>
                            <span className="text-[10px] font-mono text-slate-600 truncate">{product.codigo_universal}</span>
                        </div>
                    )}
                    {product.variante && (
                        <div className="flex items-center gap-2">
                            <span className="text-[9px] font-bold uppercase text-slate-400 w-16 shrink-0">Variante</span>
                            <span className="text-[10px] text-slate-600 truncate">{product.variante}</span>
                        </div>
                    )}
                                        {product.caja_madre && (
                        <div className="flex items-center gap-2">
                            <span className="text-[9px] font-bold uppercase text-slate-400 w-16 shrink-0">Caja Madre</span>
                            <span className="text-[10px] text-slate-600 truncate">{product.caja_madre}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Stock Control */}
            <div className="px-3 pb-3 border-t border-slate-100 pt-2 mt-auto">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                        {isLowStock && <AlertCircle className="w-3 h-3 text-amber-500" />}
                        <p className={cn(
                            "text-[10px] uppercase font-bold",
                            isLowStock ? "text-amber-500" : "text-slate-400"
                        )}>
                                            Stock Fisico
                        </p>
                    </div>
                    {editing ? (
                        <div className="flex items-center gap-1">
                            <input
                                type="number"
                                value={stockInput}
                                onChange={(e) => setStockInput(e.target.value)}
                                className="w-16 px-2 py-1 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-center"
                                autoFocus
                                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                            />
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="p-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                            >
                                <Save className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 group/edit cursor-pointer" onClick={() => setEditing(true)}>
                            <span className={cn(
                                "text-xl font-black",
                                isLowStock ? "text-rose-600" : "text-emerald-600"
                            )}>
                                {newStock}
                            </span>
                            <Edit2 className="w-3 h-3 text-slate-300 group-hover/edit:text-indigo-600 transition-colors" />
                        </div>
                    )}
                </div>
            </div>

            {/* Action Footer */}
            <div className="px-3 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                <Link href={`/catalog/${product.articulo_id}`} className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 transition-colors">
                    Ver Ficha
                </Link>
                <Link
                    href={`/autoficha?articulo_id=${encodeURIComponent(product.articulo_id)}`}
                    className="text-xs font-bold text-emerald-600 hover:text-emerald-800 flex items-center gap-1 transition-colors"
                    title="Crear ficha técnica para este artículo"
                >
                    <FileText className="w-3 h-3" /> Crear ficha
                </Link>
            </div>
        </div>
    );
}
