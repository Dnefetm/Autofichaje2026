'use client';
import { useState } from 'react';

export function ReglaForm() {
    const [nombre, setNombre] = useState('');
    const [prioridad, setPrioridad] = useState(1);
    
    // Core Margins
    const [margenPorcentaje, setMargenPorcentaje] = useState(0);
    const [margenFijo, setMargenFijo] = useState(0);

    // Retentions
    const [retencionMarketplace, setRetencionMarketplace] = useState(0);
    const [comisionPago, setComisionPago] = useState(0);
    const [ivaEfectivo, setIvaEfectivo] = useState(16);

    // Filters
    const [filtroMarca, setFiltroMarca] = useState('');
    const [filtroCategoria, setFiltroCategoria] = useState('');

    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        const res = await fetch('/api/precios/reglas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                nombre, 
                prioridad,
                margen_porcentaje: margenPorcentaje,
                margen_fijo: margenFijo,
                retencion_marketplace_porcentaje: retencionMarketplace,
                comision_pago_porcentaje: comisionPago,
                iva_efectivo_porcentaje: ivaEfectivo,
                filtro_marca: filtroMarca,
                filtro_categoria: filtroCategoria
            })
        });
        setLoading(false);
        if(res.ok) window.location.reload();
        else alert('Error guardando la regla');
    };

    return (
        <form onSubmit={handleSubmit} className="flex flex-col space-y-6 max-w-2xl bg-white p-6 rounded-lg shadow-sm border border-slate-200">
            <h3 className="font-semibold text-lg text-slate-800 border-b pb-2">Configuración Principal</h3>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nombre de la Regla</label>
                    <input className="border border-slate-300 w-full p-2 rounded shadow-sm focus:ring-indigo-500 focus:border-indigo-500" placeholder="Ej. Margen Seguro 20%" value={nombre} onChange={e=>setNombre(e.target.value)} required />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Prioridad (1 = Más alta)</label>
                    <input className="border border-slate-300 w-full p-2 rounded shadow-sm focus:ring-indigo-500 focus:border-indigo-500" type="number" min="1" value={prioridad} onChange={e=>setPrioridad(Number(e.target.value))} required />
                </div>
            </div>

            <h3 className="font-semibold text-lg text-slate-800 border-b pb-2">Rentabilidad y Retenciones</h3>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Margen Deseado (%)</label>
                    <input className="border border-slate-300 w-full p-2 rounded shadow-sm focus:ring-indigo-500 focus:border-indigo-500" type="number" step="0.01" value={margenPorcentaje} onChange={e=>setMargenPorcentaje(Number(e.target.value))} />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Costos Fijos / Margen Fijo ($)</label>
                    <input className="border border-slate-300 w-full p-2 rounded shadow-sm focus:ring-indigo-500 focus:border-indigo-500" type="number" step="0.01" value={margenFijo} onChange={e=>setMargenFijo(Number(e.target.value))} />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Retención Marketplace (%)</label>
                    <input className="border border-slate-300 w-full p-2 rounded shadow-sm focus:ring-indigo-500 focus:border-indigo-500" type="number" step="0.01" value={retencionMarketplace} onChange={e=>setRetencionMarketplace(Number(e.target.value))} />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Comisión Método Pago (%)</label>
                    <input className="border border-slate-300 w-full p-2 rounded shadow-sm focus:ring-indigo-500 focus:border-indigo-500" type="number" step="0.01" value={comisionPago} onChange={e=>setComisionPago(Number(e.target.value))} />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">IVA Efectivo (%)</label>
                    <input className="border border-slate-300 w-full p-2 rounded shadow-sm focus:ring-indigo-500 focus:border-indigo-500" type="number" step="0.01" value={ivaEfectivo} onChange={e=>setIvaEfectivo(Number(e.target.value))} />
                </div>
            </div>

            <h3 className="font-semibold text-lg text-slate-800 border-b pb-2">Filtros de Aplicación</h3>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Filtro por Marca (Opcional)</label>
                    <input className="border border-slate-300 w-full p-2 rounded shadow-sm focus:ring-indigo-500 focus:border-indigo-500" placeholder="Ej. Urrea" value={filtroMarca} onChange={e=>setFiltroMarca(e.target.value)} />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Filtro por Categoría (Opcional)</label>
                    <input className="border border-slate-300 w-full p-2 rounded shadow-sm focus:ring-indigo-500 focus:border-indigo-500" placeholder="Ej. Herramientas Manuales" value={filtroCategoria} onChange={e=>setFiltroCategoria(e.target.value)} />
                </div>
            </div>

            <div className="flex justify-end pt-4">
                <button disabled={loading} className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-medium shadow hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                    {loading ? 'Guardando...' : 'Guardar Regla de Pricing'}
                </button>
            </div>
        </form>
    );
}
