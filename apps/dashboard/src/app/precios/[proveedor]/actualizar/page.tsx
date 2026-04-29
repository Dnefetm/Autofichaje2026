'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function ActualizarListaPage({ params }: { params: { proveedor: string } }) {
    const proveedorDecoded = decodeURIComponent(params.proveedor);
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setFile(e.target.files[0]);
        }
    };

    const handleUpload = async () => {
        if (!file) return;
        setUploading(true);
        // Note: For a real production app, we would upload to Supabase Storage first,
        // then send the signed URL to the Edge Function or API route.
        // As per the brief: POST a /api/precios/importar
        const formData = new FormData();
        formData.append('file', file);
        formData.append('proveedor', proveedorDecoded);

        try {
            const res = await fetch('/api/precios/importar', {
                method: 'POST',
                body: formData
            });
            if (res.ok) {
                window.location.href = `/precios/${encodeURIComponent(proveedorDecoded)}/historial`;
            } else {
                alert('Error al subir el archivo');
            }
        } catch (e) {
            alert('Error de conexión');
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="p-8 h-screen bg-slate-50 flex flex-col items-center">
            <div className="w-full max-w-2xl bg-white p-8 rounded-lg shadow mt-10">
                <div className="mb-6">
                    <Link href={`/precios/${encodeURIComponent(proveedorDecoded)}/historial`} className="text-indigo-600 hover:underline text-sm mb-2 inline-block">
                        &larr; Volver al historial
                    </Link>
                    <h1 className="text-2xl font-bold text-slate-900">Actualizar Lista de Precios</h1>
                    <p className="text-slate-500">Sube el archivo XLSX más reciente para el proveedor {proveedorDecoded}</p>
                </div>

                <div className="border-2 border-dashed border-slate-300 rounded-lg p-10 text-center hover:bg-slate-50 transition">
                    <input 
                        type="file" 
                        accept=".xlsx, .xls, .csv" 
                        onChange={handleFileChange}
                        className="mb-4 block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                    />
                    {file && <p className="text-sm text-slate-700 font-medium">Archivo seleccionado: {file.name}</p>}
                </div>

                <div className="mt-6 flex justify-end">
                    <button 
                        onClick={handleUpload} 
                        disabled={!file || uploading}
                        className="bg-indigo-600 text-white px-6 py-2 rounded-md font-medium shadow disabled:opacity-50 transition-colors"
                    >
                        {uploading ? 'Procesando...' : 'Subir y Procesar'}
                    </button>
                </div>
            </div>
        </div>
    );
}
