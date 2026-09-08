'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import { Loader2, Save } from 'lucide-react';

export default function MapearColumnasPage() {
    const params = useParams();
    const proveedor = decodeURIComponent((params?.proveedor as string) || '');
    const searchParams = useSearchParams();
    const importacionId = searchParams?.get('importacion_id');
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [headers, setHeaders] = useState<string[]>([]);
    const [preview, setPreview] = useState<string[][]>([]);
    
    // Mapeo form state
    const [colCodigo, setColCodigo] = useState('');
    const [colModelo, setColModelo] = useState('');
    const [colMarca, setColMarca] = useState('');
    const [colDescripcion, setColDescripcion] = useState('');
    const [moneda, setMoneda] = useState('MXN');
    const [precios, setPrecios] = useState<{ columna: string, tipo_costo: string, incluye_iva: boolean }[]>([]);
    const [marcaDefault, setMarcaDefault] = useState('');
    const [marcasDistintas, setMarcasDistintas] = useState<{ marca: string, count: number }[]>([]);
    const [marcasValidas, setMarcasValidas] = useState<Set<string>>(new Set());
    const [showMarcas, setShowMarcas] = useState(false);
    
    // Lista de tipos de costos predefinidos para agilizar (solo sugerencias, el campo es libre)
    const tiposCosto = ['distribuidor', 'subdistribuidor', 'mayoreo', 'menudeo'];

    useEffect(() => {
        if (!importacionId) {
            setError('No importacion_id provided');
            setLoading(false);
            return;
        }

        fetch(`/api/precios/importar/${importacionId}/headers`)
            .then(res => res.json())
            .then(data => {
                if (!data.ok) throw new Error(data.error);
                setHeaders(data.headers || []);
                setPreview(data.preview || []);
                
                const m = data.mapeo_actual || {};
                setColCodigo(m.columna_codigo || '');
                setColModelo(m.columna_modelo || '');
                setColMarca(m.columna_marca || '');
                setColDescripcion(m.columna_descripcion || '');
                setMoneda(m.moneda_default || 'MXN');
                
                if (Array.isArray(m.precios) && m.precios.length > 0) {
                    setPrecios(m.precios);
                } else {
                    setPrecios([{ columna: '', tipo_costo: 'distribuidor', incluye_iva: true }]);
                }
                
                setLoading(false);
            })
            .catch(err => {
                setError(err.message);
                setLoading(false);
            });
    }, [importacionId]);

    const handleAddPrecio = () => {
        setPrecios([...precios, { columna: '', tipo_costo: 'nuevo_tipo', incluye_iva: true }]);
    };

    const handlePrecioChange = (index: number, field: string, value: any) => {
        const newPrecios = [...precios];
        (newPrecios[index] as any)[field] = value;
        setPrecios(newPrecios);
    };

    const handleRemovePrecio = (index: number) => {
        setPrecios(precios.filter((_, i) => i !== index));
    };

    const procesarYRedirigir = async () => {
        const rProc = await fetch(`/api/precios/importar/${importacionId}/procesar`, { method: 'POST' });
        if (!rProc.ok) {
            const jProc = await rProc.json().catch(() => ({}));
            throw new Error(jProc.error || 'Error al procesar precios.');
        }
        router.push(`/precios/${encodeURIComponent(proveedor)}/historial/${importacionId}/resumen`);
    };

    const guardarMapeo = async (extra: Record<string, any> = {}) => {
        const rMap = await fetch(`/api/precios/importar/${importacionId}/mapeo`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                columna_codigo: colCodigo,
                columna_modelo: colModelo,
                columna_marca: colMarca || null,
                columna_descripcion: colDescripcion,
                moneda_default: moneda,
                precios: precios.filter(p => p.columna),
                columnas_a_guardar: headers,
                ...extra,
            })
        });
        const jMap = await rMap.json();
        if (!rMap.ok) throw new Error(jMap.error);
    };

    const handleGuardar = async () => {
        setSaving(true);
        setError(null);
        try {
            await guardarMapeo();

            // Iniciar parser
            const rParse = await fetch(`/api/precios/importar/${importacionId}/iniciar-parser`, { method: 'POST' });
            if (!rParse.ok) {
                const jParse = await rParse.json().catch(() => ({}));
                throw new Error(jParse.error || 'Error al iniciar procesamiento.');
            }

            // Extraer los valores distintos de la columna de marca para aprobar cuáles son reales
            if (colMarca) {
                const rMarcas = await fetch(`/api/precios/importar/${importacionId}/marcas-distintas`);
                const jMarcas = await rMarcas.json();
                if (jMarcas.ok && Array.isArray(jMarcas.marcas) && jMarcas.marcas.length > 0) {
                    setMarcasDistintas(jMarcas.marcas);
                    setMarcasValidas(new Set());
                    setShowMarcas(true);
                    setSaving(false);
                    return;
                }
            }

            await procesarYRedirigir();
        } catch (e: any) {
            setError(e.message);
            setSaving(false);
        }
    };

    const handleConfirmarMarcas = async () => {
        setSaving(true);
        setError(null);
        try {
            await guardarMapeo({
                marca_default: marcaDefault || null,
                marcas_validas: Array.from(marcasValidas),
            });
            await procesarYRedirigir();
        } catch (e: any) {
            setError(e.message);
            setSaving(false);
        }
    };

    if (loading) return <div className="p-8 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-[var(--accent)]" /></div>;

    return (
        <div className="p-8 max-w-5xl mx-auto min-h-screen">
            <h2 className="text-2xl font-bold text-[var(--text)] mb-2">Mapear Columnas - {proveedor}</h2>
            <p className="text-[var(--text-muted)] mb-8">Asigna las columnas correctas del archivo a los campos del sistema.</p>

            {error && <div className="mb-6 p-4 bg-[var(--err)]/10 text-[var(--err)] rounded-lg">{error}</div>}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                
                {/* Panel Izquierdo: Configuración General */}
                <div className="bg-[var(--surface)] border rounded-xl p-6 shadow-sm">
                    <h3 className="font-semibold text-lg border-b pb-2 mb-4">Campos Principales</h3>
                    
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Columna Código Universal (UPC/EAN/GTIN) *</label>
                            <select className="w-full border p-2 rounded-md" value={colCodigo} onChange={e => setColCodigo(e.target.value)}>
                                <option value="">-- Seleccionar --</option>
                                {headers.map((h, i) => <option key={i} value={h}>{h}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Columna Modelo (Referencia / N° de parte) *</label>
                            <select className="w-full border p-2 rounded-md" value={colModelo} onChange={e => setColModelo(e.target.value)}>
                                <option value="">-- Seleccionar --</option>
                                {headers.map((h, i) => <option key={i} value={h}>{h}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Columna MARCA <span className="text-[var(--text-faint)]">(opcional)</span></label>
                            <select className="w-full border p-2 rounded-md" value={colMarca} onChange={e => setColMarca(e.target.value)}>
                                <option value="">-- Seleccionar --</option>
                                {headers.map((h, i) => <option key={i} value={h}>{h}</option>)}
                            </select>
                            <p className="text-[10px] text-[var(--text-faint)] mt-1">Si la lista no trae columna de marca, déjala vacía.</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Columna DESCRIPCIÓN</label>
                            <select className="w-full border p-2 rounded-md" value={colDescripcion} onChange={e => setColDescripcion(e.target.value)}>
                                <option value="">-- Seleccionar --</option>
                                {headers.map((h, i) => <option key={i} value={h}>{h}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Moneda por defecto</label>
                            <select className="w-full border p-2 rounded-md" value={moneda} onChange={e => setMoneda(e.target.value)}>
                                <option value="MXN">MXN - Peso Mexicano</option>
                                <option value="USD">USD - Dólar Estadounidense</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Panel Derecho: Precios */}
                <div className="bg-[var(--surface)] border rounded-xl p-6 shadow-sm">
                    <h3 className="font-semibold text-lg border-b pb-2 mb-4">Mapeo de Precios</h3>
                    
                    <div className="space-y-4">
                        {precios.map((p, index) => (
                            <div key={index} className="p-4 border rounded-md relative bg-[var(--bg)]">
                                <button onClick={() => handleRemovePrecio(index)} className="absolute top-2 right-2 text-[var(--err)] hover:brightness-110 font-bold">✕</button>
                                
                                <label className="block text-xs font-medium text-[var(--text-muted)] uppercase mb-1">Columna Excel</label>
                                <select className="w-full border p-2 rounded-md mb-2 bg-[var(--surface)]" value={p.columna} onChange={e => handlePrecioChange(index, 'columna', e.target.value)}>
                                    <option value="">-- Seleccionar Columna --</option>
                                    {headers.map((h, i) => <option key={i} value={h}>{h}</option>)}
                                </select>
                                
                                <div className="flex gap-2">
                                    <div className="flex-1">
                                        <label className="block text-xs font-medium text-[var(--text-muted)] uppercase mb-1">Tipo de Costo</label>
                                        <input type="text" className="w-full border p-2 rounded-md bg-[var(--surface)]" value={p.tipo_costo} onChange={e => handlePrecioChange(index, 'tipo_costo', e.target.value)} list="tiposCosto" />
                                        <datalist id="tiposCosto">
                                            {tiposCosto.map(t => <option key={t} value={t} />)}
                                        </datalist>
                                    </div>
                                    <div className="w-24 flex items-end pb-2">
                                        <label className="flex items-center text-sm cursor-pointer" title="Marca esta casilla si el precio en el Excel ya tiene el IVA sumado">
                                            <input type="checkbox" className="mr-2 rounded text-[var(--accent)] focus:ring-[var(--accent)]" checked={p.incluye_iva} onChange={e => handlePrecioChange(index, 'incluye_iva', e.target.checked)} />
                                            ¿Ya incluye IVA?
                                        </label>
                                    </div>
                                </div>
                            </div>
                        ))}
                        
                        <button onClick={handleAddPrecio} className="w-full py-2 border-2 border-dashed border-[var(--accent)]/50 text-[var(--accent)] rounded-md hover:bg-[var(--accent)]/10 font-medium">
                            + Añadir Nivel de Precio
                        </button>
                    </div>
                </div>
            </div>

            {/* Panel Inferior: Vista Previa */}
            <div className="mt-8 bg-[var(--surface)] border rounded-xl p-6 shadow-sm overflow-x-auto">
                <h3 className="font-semibold text-lg border-b pb-2 mb-4">Vista Previa de Datos (Primeras 3 filas)</h3>
                <table className="w-full text-sm text-left border-collapse">
                    <thead>
                        <tr className="bg-[var(--surface-2)]">
                            {headers.map((h, i) => (
                                <th key={i} className="p-2 border font-medium text-[var(--text-muted)] whitespace-nowrap">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {preview.map((row, rIdx) => (
                            <tr key={rIdx} className="hover:bg-[var(--bg)]">
                                {headers.map((_, cIdx) => (
                                    <td key={cIdx} className="p-2 border text-[var(--text-muted)] max-w-[200px] truncate" title={row[cIdx]}>{row[cIdx]}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="mt-8 flex justify-end">
                <button 
                    onClick={handleGuardar}
                    disabled={saving || !colCodigo || !colModelo}
                    className="bg-[var(--accent)] text-[var(--accent-ink)] px-8 py-3 rounded-lg font-medium shadow-sm hover:brightness-110 disabled:opacity-50 flex items-center text-lg"
                >
                    {saving ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Save className="w-5 h-5 mr-2" />}
                    Guardar y Procesar Archivo
                </button>
            </div>

            {showMarcas && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowMarcas(false)}>
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
                        <h3 className="font-bold text-lg text-[var(--text)] mb-1">Aprobar marcas</h3>
                        <p className="text-xs text-[var(--text-muted)] mb-4">
                            Valores encontrados en la columna <strong className="text-[var(--text)]">{colMarca}</strong>. Marca cuáles son marcas reales; los no marcados se reemplazarán por la marca por defecto.
                        </p>

                        <label className="block text-xs font-bold text-[var(--text-muted)] mb-1">Marca por defecto</label>
                        <input type="text" value={marcaDefault} onChange={e => setMarcaDefault(e.target.value)} placeholder="ej. Victorinox" className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--bg)] text-sm mb-4 text-[var(--text)]" />

                        <div className="max-h-64 overflow-y-auto border border-[var(--border)] rounded-lg divide-y divide-[var(--border)] mb-4">
                            {marcasDistintas.map(m => (
                                <label key={m.marca} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-[var(--bg)]">
                                    <input type="checkbox" checked={marcasValidas.has(m.marca)} onChange={e => {
                                        const next = new Set(marcasValidas);
                                        if (e.target.checked) next.add(m.marca); else next.delete(m.marca);
                                        setMarcasValidas(next);
                                    }} className="rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]" />
                                    <span className="flex-1 text-sm text-[var(--text)]">{m.marca}</span>
                                    <span className="text-xs text-[var(--text-faint)]">{m.count} filas</span>
                                </label>
                            ))}
                        </div>

                        <div className="flex justify-end gap-2">
                            <button onClick={() => setShowMarcas(false)} className="px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg)] rounded-lg">Cancelar</button>
                            <button onClick={handleConfirmarMarcas} disabled={saving} className="px-5 py-2 bg-[var(--accent)] text-[var(--accent-ink)] rounded-lg text-sm font-bold hover:brightness-110 disabled:opacity-50 flex items-center gap-2">
                                {saving && <Loader2 className="w-4 h-4 animate-spin" />} Confirmar y procesar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
