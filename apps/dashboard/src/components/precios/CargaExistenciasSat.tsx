'use client';
import { useRef, useState } from 'react';
import { FileUp, Loader2 } from 'lucide-react';
import { obtenerAdapter, mergeFilas } from '@/lib/proveedor-adapter';
import { registrarAdaptadoresProveedores } from '@/lib/adapters';

// Registro idempotente de adapters (Urrea + Wurth + Tuk)
registrarAdaptadoresProveedores();

/**
 * Sección integrada en la página del proveedor para cargar existencias (stock) y claves SAT.
 * El archivo se parsea EN EL NAVEGADOR (CPU del cliente); solo se envían las filas limpias
 * a /api/precios/importar/feed para el upsert en catalogo_proveedor.
 */
export function CargaExistenciasSat({ proveedor }: { proveedor: string }) {
    const [cargando, setCargando] = useState<'existencias' | 'sat' | null>(null);
    const [resultado, setResultado] = useState<Record<string, string>>({});
    const [error, setError] = useState<string | null>(null);
    const inputEx = useRef<HTMLInputElement>(null);
    const inputSat = useRef<HTMLInputElement>(null);

    async function procesar(f: File, tipo: 'existencias' | 'sat') {
        setCargando(tipo);
        setError(null);
        try {
            const adapter = obtenerAdapter(proveedor);
            if (!adapter) throw new Error(`No hay adapter para "${proveedor}"`);
            const ext = f.name.split('.').pop()?.toLowerCase() || '';
            const tipoArchivo = ext === 'pdf' ? 'pdf' : 'xlsx';

            // Parsear EN EL NAVEGADOR
            const buf = new Uint8Array(await f.arrayBuffer());
            const filas = await adapter.parse({ nombre: f.name, buffer: buf, tipo: tipoArchivo, feed: tipo });
            if (!filas.length) throw new Error('No se extrajeron filas del archivo');

            // Merge por (proveedor, sku_norm) en el cliente
            const merged = mergeFilas(filas);
            const payload = [...merged.values()].map((x) => ({
                proveedor: x.proveedor,
                sku_norm: x.sku_norm,
                sku_proveedor: x.sku_proveedor,
                descripcion: x.descripcion ?? null,
                stock: x.stock ?? null,
                codigo_sat: x.codigo_sat ?? null,
            }));

            // Solo enviar filas limpias al backend
            const r = await fetch('/api/precios/importar/feed', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ proveedor: adapter.nombre, tipo, filas: payload, nombre: f.name }),
            });
            const d = await r.json();
            if (!d.ok) throw new Error(d.error);
            setResultado((prev) => ({ ...prev, [tipo]: `${Number(d.filas || 0).toLocaleString()} filas` }));
        } catch (e: any) {
            setError(e.message || 'Error procesando el archivo');
        } finally {
            setCargando(null);
        }
    }

    return (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-sm p-5">
            <h3 className="text-sm font-bold text-[var(--text)] mb-1">Carga de Existencias y SAT</h3>
            <p className="text-xs text-[var(--text-muted)] mb-4">
                Sube el archivo tal como lo entrega el proveedor (Excel o PDF). Se procesa en tu navegador y solo se envían los datos limpios.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="border border-dashed border-[var(--border)] rounded-lg p-4 flex flex-col gap-2">
                    <p className="text-sm font-semibold text-[var(--text)]">Existencias (stock)</p>
                    <input
                        ref={inputEx}
                        type="file"
                        accept=".pdf,.xlsx,.xls"
                        className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) procesar(f, 'existencias'); e.target.value = ''; }}
                    />
                    <button
                        onClick={() => inputEx.current?.click()}
                        disabled={cargando !== null}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] text-sm font-bold hover:brightness-110 transition disabled:opacity-50"
                    >
                        {cargando === 'existencias' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
                        Subir existencias
                    </button>
                    {resultado.existencias && <span className="text-xs text-[var(--ok)] font-semibold">✓ {resultado.existencias}</span>}
                </div>

                <div className="border border-dashed border-[var(--border)] rounded-lg p-4 flex flex-col gap-2">
                    <p className="text-sm font-semibold text-[var(--text)]">Claves SAT</p>
                    <input
                        ref={inputSat}
                        type="file"
                        accept=".pdf,.xlsx,.xls"
                        className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) procesar(f, 'sat'); e.target.value = ''; }}
                    />
                    <button
                        onClick={() => inputSat.current?.click()}
                        disabled={cargando !== null}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] text-sm font-bold hover:brightness-110 transition disabled:opacity-50"
                    >
                        {cargando === 'sat' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
                        Subir SAT
                    </button>
                    {resultado.sat && <span className="text-xs text-[var(--ok)] font-semibold">✓ {resultado.sat}</span>}
                </div>
            </div>

            {error && <p className="text-xs text-[var(--err)] mt-3">{error}</p>}
        </div>
    );
}
