import React, { useState } from 'react';
import { AlertCircle, Save, Edit2, Image as ImageIcon, FileText, Link2 } from 'lucide-react';
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

// Estados de la ficha técnica (asociación artículo ↔ fichas_tecnicas)
const FICHA_ESTADO: Record<string, { label: string; color: string }> = {
    borrador:  { label: 'Borrador',  color: 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]' },
    revision:  { label: 'Revisión',  color: 'bg-[var(--warn)]/10 text-[var(--warn)] border-[var(--warn)]/30' },
    publicado: { label: 'Publicada', color: 'bg-[var(--ok)]/10 text-[var(--ok)] border-[var(--ok)]/30' },
};

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

    const mapeos = Array.isArray(product.mapeo_publicacion_articulo)
        ? product.mapeo_publicacion_articulo
        : product.mapeo_publicacion_articulo ? [product.mapeo_publicacion_articulo] : [];
    const isMapped = mapeos.length > 0;

    const fichas = Array.isArray(product.fichas_tecnicas) ? product.fichas_tecnicas : [];
    // Preferir la publicada; si no, la primera (más reciente según la query)
    const fichaPrincipal = fichas.find((f: any) => f?.estado === 'publicado') || fichas[0] || null;
    const fichaEstado = fichaPrincipal
        ? (FICHA_ESTADO[fichaPrincipal.estado] || { label: fichaPrincipal.estado || 'Ficha', color: 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]' })
        : null;

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

    const articuloUrl = `/catalog/${encodeURIComponent(product.articulo_id)}`;

    return (
        <div
            className={cn(
                "bg-[var(--surface)] rounded-[var(--radius)] border overflow-hidden flex flex-col transition-colors",
                isSelected
                    ? "border-[var(--accent)] ring-1 ring-[var(--accent)]"
                    : "border-[var(--border)] hover:border-[var(--border-strong)]"
            )}
        >
            {/* — Identidad · master data (AppSheet, solo lectura) — */}
            <div className="relative">
                <Link href={articuloUrl} className="block aspect-square bg-[var(--surface-2)] flex items-center justify-center overflow-hidden">
                    {image && !imgError ? (
                        <img
                            src={image}
                            alt={product.nombre}
                            className="w-full h-full object-contain"
                            onError={() => setImgError(true)}
                        />
                    ) : (
                        <div className="flex flex-col items-center justify-center gap-2 text-[var(--text-faint)]">
                            <ImageIcon className="w-12 h-12 opacity-50" />
                            <span className="text-xs font-medium">Sin imagen</span>
                        </div>
                    )}
                </Link>

                {/* Estado de publicación (resumen; la gestión va dentro del artículo) */}
                <div className="absolute top-2 left-2 pointer-events-none">
                    {isMapped ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border bg-[var(--ok)]/10 text-[var(--ok)] border-[var(--ok)]/30">
                            <Link2 className="w-3 h-3" /> {mapeos.length} {mapeos.length === 1 ? 'publ.' : 'publs.'}
                        </span>
                    ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]">
                            Sin publicar
                        </span>
                    )}
                </div>

                {/* Checkbox de selección masiva */}
                <div className="absolute top-2 right-2" onClick={(e) => e.stopPropagation()}>
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelection?.(product.articulo_id)}
                        aria-label={`Seleccionar ${product.nombre || product.articulo_id}`}
                        className="w-4 h-4 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)] cursor-pointer"
                    />
                </div>
            </div>

            {/* — Cuerpo: identidad — */}
            <div className="p-3 flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-faint)]">
                        {product.marca || 'GENERIC'}
                    </span>
                    <span className="text-[9px] uppercase tracking-wider text-[var(--text-faint)] opacity-70">AppSheet</span>
                </div>
                <h3 className="text-sm font-semibold text-[var(--text)] leading-snug line-clamp-2">
                    {product.nombre}
                </h3>

                <dl className="mt-1 space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2">
                        <dt className="text-[var(--text-faint)] shrink-0">SKU</dt>
                        <dd className="font-mono text-[var(--text-muted)] truncate">{product.articulo_id}</dd>
                    </div>
                    {product.modelo && (
                        <div className="flex items-center justify-between gap-2">
                            <dt className="text-[var(--text-faint)] shrink-0">Modelo</dt>
                            <dd className="font-mono text-[var(--text-muted)] truncate">{product.modelo}</dd>
                        </div>
                    )}
                    {product.codigo_universal && (
                        <div className="flex items-center justify-between gap-2">
                            <dt className="text-[var(--text-faint)] shrink-0">UPC/EAN</dt>
                            <dd className="font-mono text-[var(--text-muted)] truncate">{product.codigo_universal}</dd>
                        </div>
                    )}
                    {product.categoria && (
                        <div className="flex items-center justify-between gap-2">
                            <dt className="text-[var(--text-faint)] shrink-0">Categoría</dt>
                            <dd className="text-[var(--text-muted)] truncate">{product.categoria}</dd>
                        </div>
                    )}
                </dl>
            </div>

            {/* — Operación (datos del gestor) — */}
            <div className="px-3 pb-3 mt-auto">
                {/* Asociación de ficha técnica */}
                <div className="flex items-center justify-between border-t border-[var(--border)] pt-2 pb-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-muted)]">
                        <FileText className="w-3.5 h-3.5 text-[var(--text-faint)]" /> Ficha técnica
                    </span>
                    {fichaPrincipal ? (
                        <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border", fichaEstado!.color)}>
                            {fichaEstado!.label}{fichas.length > 1 ? ` · ${fichas.length}` : ''}
                        </span>
                    ) : (
                        <span className="text-[10px] text-[var(--text-faint)]">Sin ficha</span>
                    )}
                </div>

                {/* Stock — control existente, sin cambios */}
                <div className="border-t border-[var(--border)] pt-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                            {isLowStock && <AlertCircle className="w-3 h-3 text-amber-500" />}
                            <p className={cn(
                                "text-[10px] uppercase font-bold",
                                isLowStock ? "text-amber-500" : "text-[var(--text-faint)]"
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
                                    className="w-16 px-2 py-1 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-[var(--accent)] outline-none text-center"
                                    autoFocus
                                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                                />
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="p-1.5 bg-[var(--accent)] text-[var(--accent-ink)] rounded hover:brightness-110 disabled:opacity-50 transition-colors"
                                >
                                    <Save className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-1.5 group/edit cursor-pointer" onClick={() => setEditing(true)}>
                                <span className={cn(
                                    "text-xl font-black",
                                    isLowStock ? "text-[var(--err)]" : "text-[var(--ok)]"
                                )}>
                                    {newStock}
                                </span>
                                <Edit2 className="w-3 h-3 text-slate-300 group-hover/edit:text-[var(--accent)] transition-colors" />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* — Acciones (unívocas) — */}
            <div className="px-3 py-2 bg-[var(--surface-2)] border-t border-[var(--border)] flex items-center justify-between gap-2">
                <Link
                    href={articuloUrl}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold rounded-[var(--radius-sm)] hover:brightness-110 transition-colors"
                >
                    Abrir artículo
                </Link>
                {fichaPrincipal ? (
                    <Link
                        href={`/fichas/${fichaPrincipal.id}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-[var(--accent)] bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded-[var(--radius-sm)] hover:bg-[var(--accent)]/20 transition-colors"
                    >
                        <FileText className="w-3.5 h-3.5" /> Ver ficha técnica
                    </Link>
                ) : (
                    <Link
                        href={`/autoficha?articulo_id=${encodeURIComponent(product.articulo_id)}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-[var(--accent)] bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded-[var(--radius-sm)] hover:bg-[var(--accent)]/20 transition-colors"
                    >
                        <FileText className="w-3.5 h-3.5" /> Crear ficha técnica
                    </Link>
                )}
            </div>
        </div>
    );
}
