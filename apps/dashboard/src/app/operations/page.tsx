"use client";

import { useState } from 'react';
import {
    Database,
    FileSpreadsheet,
    Play,
    AlertTriangle,
    CheckCircle2,
    Info,
    ArrowRight,
    Loader2,
    FileCheck
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type OperationType = 'stock' | 'price';

export default function OperationsPage() {
    const [file, setFile] = useState<File | null>(null);
    const [operation, setOperation] = useState<OperationType>('stock');
    const [previewData, setPreviewData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<'idle' | 'preview' | 'success' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState('');

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            parseFile(selectedFile);
        }
    };

    const parseFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result as string;
            const lines = text.split('\n');
            const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

            const data = lines.slice(1).filter(l => l.trim()).map(line => {
                const values = line.split(',').map(v => v.trim());
                const obj: any = {};
                headers.forEach((h, i) => obj[h] = values[i]);
                return obj;
            });

            setPreviewData(data);
            setStatus('preview');
        };
        reader.readAsText(file);
    };

    const handleExecute = async () => {
        setLoading(true);
        try {
            if (operation === 'stock') {
                for (const row of previewData) {
                    if (!row.sku || row.stock === undefined) continue;

                    // 1. Actualizar stock local
                    const { error } = await supabase
                        .from('inventory_snapshot')
                        .update({ physical_stock: parseInt(row.stock) })
                        .eq('sku', row.sku);

                    if (error) throw error;

                    // 2. Notificar al sistema para que sincronice (el worker detectará el cambio vía trigger o polling)
                    // En un sistema real, el trigger de DB en inventory_snapshot encolaría los jobs.
                }
            } else {
                for (const row of previewData) {
                    if (!row.sku || row.precio === undefined) continue;

                    const { error } = await supabase
                        .from('marketplace_prices')
                        .upsert({
                            sku: row.sku,
                            sale_price: parseFloat(row.precio),
                            marketplace_id: '00000000-0000-0000-0000-000000000000' // Placeholder para cuenta principal
                        }, { onConflict: 'sku,marketplace_id' });

                    if (error) throw error;
                }
            }
            setStatus('success');
        } catch (err: any) {
            console.error(err);
            setErrorMessage(err.message || 'Error desconocido al procesar el archivo');
            setStatus('error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
            <div className="flex justify-between items-end">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900">Operaciones Masivas</h2>
                    <p className="text-slate-500 text-sm">Gestiona miles de SKUs simultáneamente mediante archivos CSV.</p>
                </div>
                <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button
                        onClick={() => { setOperation('stock'); setStatus('idle'); }}
                        className={cn("px-4 py-1.5 rounded-md text-xs font-bold transition-all", operation === 'stock' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}
                    >Stock</button>
                    <button
                        onClick={() => { setOperation('price'); setStatus('idle'); }}
                        className={cn("px-4 py-1.5 rounded-md text-xs font-bold transition-all", operation === 'price' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}
                    >Precios</button>
                </div>
            </div>

            {/* Zona de Carga */}
            <div className={cn(
                "bg-white border-2 border-dashed rounded-2xl p-12 transition-all flex flex-col items-center gap-4",
                status === 'idle' ? "border-slate-200 hover:border-indigo-300" : "border-indigo-100 bg-indigo-50/20"
            )}>
                <div className={cn(
                    "w-16 h-16 rounded-full flex items-center justify-center mb-2",
                    operation === 'stock' ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-600"
                )}>
                    {operation === 'stock' ? <Database className="w-8 h-8" /> : <FileSpreadsheet className="w-8 h-8" />}
                </div>

                <div className="text-center">
                    <h3 className="text-lg font-bold text-slate-900">Sube tu archivo para {operation === 'stock' ? 'Inventario' : 'Precios'}</h3>
                    <p className="text-sm text-slate-500">Formato requerido: CSV con columnas <span className="font-mono bg-slate-100 px-1 rounded">sku</span> y <span className="font-mono bg-slate-100 px-1 rounded">{operation === 'stock' ? 'stock' : 'precio'}</span></p>
                </div>

                <div className="relative group">
                    <input
                        type="file"
                        accept=".csv"
                        onChange={handleFileChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <button className="px-8 py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-md group-hover:bg-indigo-700 transition-all">
                        Seleccionar CSV
                    </button>
                </div>
            </div>

            {/* Vista Previa y Acción */}
            {status !== 'idle' && (
                <div className="space-y-6 animate-in slide-in-from-top-4 duration-500">
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <div className="flex items-center gap-2">
                                <FileCheck className="w-4 h-4 text-emerald-500" />
                                <span className="font-bold text-sm">Vista Previa: {previewData.length} filas detectadas</span>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setStatus('idle')}
                                    className="px-4 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-700"
                                >Cancelar</button>
                                <button
                                    onClick={handleExecute}
                                    disabled={loading || status === 'success'}
                                    className={cn(
                                        "px-6 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-all shadow-sm",
                                        status === 'success' ? "bg-emerald-500 text-white" : "bg-indigo-600 text-white hover:bg-indigo-700"
                                    )}
                                >
                                    {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                                    {status === 'success' ? 'Proceso Completado' : `Ejecutar Actualización de ${operation === 'stock' ? 'Stock' : 'Precios'}`}
                                </button>
                            </div>
                        </div>

                        <div className="max-h-[300px] overflow-auto">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-slate-50/80 sticky top-0 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                                    <tr>
                                        <th className="px-6 py-3">SKU</th>
                                        <th className="px-6 py-3 text-right">Valor Detectado</th>
                                        <th className="px-6 py-3">Acción</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {previewData.slice(0, 10).map((row, i) => (
                                        <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="px-6 py-3 font-mono font-bold text-slate-700">{row.sku}</td>
                                            <td className="px-6 py-3 text-right font-bold text-indigo-600">
                                                {operation === 'stock' ? row.stock : `$${row.precio}`}
                                            </td>
                                            <td className="px-6 py-3">
                                                <div className="flex items-center gap-1 text-emerald-600 font-medium">
                                                    <ArrowRight className="w-3 h-3" />
                                                    Sincronizar
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {previewData.length > 10 && (
                                        <tr>
                                            <td colSpan={3} className="px-6 py-4 text-center text-slate-400 italic">
                                                Y {previewData.length - 10} filas más...
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {status === 'success' && (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 flex gap-4 animate-in zoom-in-95 duration-300">
                            <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
                            <div>
                                <h4 className="font-bold text-emerald-900">¡Actualización Exitosa!</h4>
                                <p className="text-emerald-700 text-sm">Los datos han sido persistidos en Supabase. El Worker iniciará la sincronización con los marketplaces en su próximo ciclo.</p>
                            </div>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 flex gap-4 animate-in zoom-in-95 duration-300">
                            <AlertTriangle className="w-6 h-6 text-rose-600 flex-shrink-0" />
                            <div>
                                <h4 className="font-bold text-rose-900">Error en el Proceso</h4>
                                <p className="text-rose-700 text-sm">{errorMessage}</p>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
