'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2, RotateCcw, BarChart2 } from 'lucide-react';
import Link from 'next/link';

export function LoteActions({ importacion, proveedor }: { importacion: any, proveedor: string }) {
    const [restoring, setRestoring] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const router = useRouter();

    const estadosEliminables = ['en_revision', 'pendiente_mapeo', 'error', 'cancelado', 'pendiente'];
    const puedeEliminar = estadosEliminables.includes(importacion.estado);

    const handleRestore = async () => {
        setRestoring(true);
        try {
            const res = await fetch('/api/precios/restaurar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ importacion_id: importacion.id })
            });
            if (res.ok) {
                router.refresh();
            } else {
                const data = await res.json();
                alert(`Error: ${data.error}`);
            }
        } catch (e) {
            alert('Error de red');
        } finally {
            setRestoring(false);
        }
    };

    const handleEliminar = async () => {
        if (!confirm(`¿Seguro que deseas eliminar esta importación?\n\nArchivo: ${importacion.nombre_archivo || importacion.id}\nEsto eliminará también los costos calculados asociados a este lote.`)) return;

        setDeleting(true);
        try {
            const res = await fetch(`/api/precios/importar/${importacion.id}/eliminar`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                router.refresh();
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (e) {
            alert('Error de red');
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="flex items-center gap-2">
            {/* Ver Resumen del Lote */}
            <Link
                href={`/precios/${encodeURIComponent(proveedor)}/historial/${importacion.id}/resumen`}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg)] transition-colors shadow-sm"
            >
                <BarChart2 className="w-3.5 h-3.5" />
                Ver Resumen
            </Link>

            {/* Restaurar lote anterior */}
            {!importacion.vigente && importacion.estado === 'completado' && (
                <button
                    onClick={handleRestore}
                    disabled={restoring}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-[var(--surface)] border border-[var(--accent)]/30 rounded-lg text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors shadow-sm disabled:opacity-50"
                >
                    {restoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    Restaurar
                </button>
            )}

            {/* Eliminar importación */}
            {puedeEliminar && (
                <button
                    onClick={handleEliminar}
                    disabled={deleting}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-[var(--surface)] border border-[var(--err)]/30 rounded-lg text-sm font-medium text-[var(--err)] hover:bg-[var(--err)]/10 transition-colors shadow-sm disabled:opacity-50"
                >
                    {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    Eliminar
                </button>
            )}
        </div>
    );
}
