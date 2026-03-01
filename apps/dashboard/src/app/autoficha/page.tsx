"use client";

import { useState } from 'react';
import { Upload, Sparkles, CheckCircle2, ChevronRight, Save, Trash2, Camera } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function AutofichaPage() {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<'idle' | 'processing' | 'done'>('idle');
    const [result, setResult] = useState<any>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) setFile(e.target.files[0]);
    };

    const handleProcess = async () => {
        if (!file) return;
        setStatus('processing');

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/api/autoficha', {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();
            setResult(data);
            setStatus('done');
        } catch (err) {
            alert('Error al procesar el documento con IA');
            setStatus('idle');
        }
    };

    const handleSave = async () => {
        if (!result) return;
        try {
            // 1. Guardar en tabla SKUs
            const { error: skuError } = await supabase.from('skus').insert({
                sku: result.sku,
                nombre: result.nombre,
                marca: result.marca,
                description: result.description,
                metadata: result.metadata
            });

            if (skuError) throw skuError;

            // 2. Crear snapshot inicial de inventario
            await supabase.from('inventory_snapshot').insert({
                sku: result.sku,
                physical_stock: 0
            });

            alert('¡Producto guardado en el catálogo maestro!');
            setResult(null);
            setStatus('idle');
            setFile(null);
        } catch (err) {
            alert('Error al guardar el producto');
        }
    };

    return (
        <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-700">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Crear con IA (AUTOFICHAS)</h2>
                <p className="text-slate-500 text-lg">Digitaliza tus catálogos de ferretería en segundos.</p>
            </div>

            {!result ? (
                <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl p-16 flex flex-col items-center justify-center text-center gap-6 hover:border-indigo-500 transition-all cursor-pointer group">
                    <input type="file" onChange={handleFileChange} className="absolute opacity-0 w-full h-full cursor-pointer" />
                    <div className="w-20 h-20 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors pointer-events-none">
                        <Upload className="w-10 h-10" />
                    </div>
                    <div>
                        <p className="font-bold text-xl">{file ? file.name : 'Suelta tu PDF o Imagen aquí'}</p>
                        <p className="text-slate-400 max-w-xs mx-auto">Soporta fichas técnicas, catálogos de proveedores o fotos de productos.</p>
                    </div>
                    {file && (
                        <button
                            onClick={(e) => { e.stopPropagation(); handleProcess(); }}
                            disabled={status === 'processing'}
                            className="mt-4 px-8 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-lg shadow-indigo-100 disabled:opacity-50"
                        >
                            <Sparkles className={cn("w-5 h-5", status === 'processing' && "animate-spin")} />
                            {status === 'processing' ? 'La IA está pensando...' : 'Estructurar con IA'}
                        </button>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Preview del Documento */}
                    <div className="bg-slate-100 rounded-2xl p-4 flex items-center justify-center min-h-[400px] border border-slate-200">
                        <div className="text-center text-slate-400">
                            <Camera className="w-12 h-12 mx-auto mb-2 opacity-50" />
                            <p className="text-sm font-medium">Previsualización de documento</p>
                            <p className="text-xs uppercase mt-1">{file?.name}</p>
                        </div>
                    </div>

                    {/* Resultado de la IA */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm space-y-6">
                        <div className="flex justify-between items-center">
                            <h3 className="text-xl font-bold flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-indigo-500" />
                                Datos Extraídos
                            </h3>
                            <button onClick={() => setResult(null)} className="text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                        </div>

                        <div className="space-y-4">
                            <DataField label="SKU Detectado" value={result.sku} />
                            <DataField label="Nombre" value={result.nombre} />
                            <DataField label="Marca" value={result.marca} />
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Descripción</label>
                                <textarea
                                    className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-sm h-24 focus:ring-1 focus:ring-indigo-500 outline-none"
                                    defaultValue={result.description}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <DataField label="Material" value={result.metadata.material} />
                                <DataField label="Dimensiones" value={result.metadata.dimensiones} />
                            </div>
                        </div>

                        <div className="pt-6 border-t border-slate-100 flex gap-4">
                            <button
                                onClick={handleSave}
                                className="flex-1 bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition-all shadow-lg flex items-center justify-center gap-2"
                            >
                                <Save className="w-5 h-5" />
                                Confirmar y Guardar
                            </button>
                            <button className="px-6 py-3 bg-slate-50 text-slate-600 font-bold rounded-xl hover:bg-slate-100 transition-all">
                                Editar más
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function DataField({ label, value }: { label: string, value: string }) {
    return (
        <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</label>
            <input
                type="text"
                className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-sm font-semibold focus:ring-1 focus:ring-indigo-500 outline-none"
                defaultValue={value}
            />
        </div>
    );
}

function cn(...classes: any[]) {
    return classes.filter(Boolean).join(' ');
}
