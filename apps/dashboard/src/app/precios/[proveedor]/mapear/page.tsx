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
    
    // Lista de tipos de costos predefinidos para agilizar
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

    const handleGuardar = async () => {
        setSaving(true);
        setError(null);
        try {
            // Guardar mapeo
            const rMap = await fetch(`/api/precios/importar/${importacionId}/mapeo`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    columna_codigo: colCodigo,
                    columna_modelo: colModelo,
                    columna_marca: colMarca,
                    columna_descripcion: colDescripcion,
                    moneda_default: moneda,
                    precios: precios.filter(p => p.columna), // Guardar solo los que tengan columna asignada
                    columnas_a_guardar: headers // Por defecto guardamos todas las leidas para facilitar la vista
                })
            });

            const jMap = await rMap.json();
            if (!rMap.ok) throw new Error(jMap.error);

            // Iniciar parser
            const rParse = await fetch(`/api/precios/importar/${importacionId}/iniciar-parser`, { method: 'POST' });
            if (!rParse.ok) {
                const jParse = await rParse.json().catch(() => ({}));
                throw new Error(jParse.error || 'Error al iniciar procesamiento.');
            }

            // Redirigir a revisión
            router.push(`/precios/matching?importacion_id=${importacionId}&proveedor=${encodeURIComponent(proveedor)}`);

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
                            <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Columna CÓDIGO DE BARRAS *</label>
                            <select className="w-full border p-2 rounded-md" value={colCodigo} onChange={e => setColCodigo(e.target.value)}>
                                <option value="">-- Seleccionar --</option>
                                {headers.map((h, i) => <option key={i} value={h}>{h}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Columna MODELO / CLAVE *</label>
                            <select className="w-full border p-2 rounded-md" value={colModelo} onChange={e => setColModelo(e.target.value)}>
                                <option value="">-- Seleccionar --</option>
                                {headers.map((h, i) => <option key={i} value={h}>{h}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Columna MARCA</label>
                            <select className="w-full border p-2 rounded-md" value={colMarca} onChange={e => setColMarca(e.target.value)}>
                                <option value="">-- Seleccionar --</option>
                                {headers.map((h, i) => <option key={i} value={h}>{h}</option>)}
                            </select>
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
        </div>
    );
}
