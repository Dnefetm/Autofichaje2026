import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { Package, Calendar, Clock, ArrowRight, Upload } from 'lucide-react';

export default async function PreciosPage() {
    const supa = supabaseAdmin;
    
    // El usuario ya desplegó la vista v_proveedores_precios
    const { data, error } = await supa.from('v_proveedores_precios').select('*');

    function fmtFecha(d: string | null) {
        if (!d) return 'Nunca';
        return new Date(d).toLocaleDateString('es-MX', { 
            year: 'numeric', month: 'short', day: 'numeric', 
            hour: '2-digit', minute: '2-digit' 
        });
    }

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <header className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Listas de Precios</h1>
                    <p className="text-slate-500 mt-1">Gestión de costos y precios por proveedor comercial.</p>
                </div>
                <Link href="/precios/importar" className="inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-md font-medium hover:bg-indigo-700 transition">
                    <Upload className="w-4 h-4" />
                    Nueva Importación
                </Link>
            </header>

            {error ? (
                <div className="p-6 bg-red-50 text-red-700 rounded-lg border border-red-200">
                    Ocurrió un error cargando los proveedores: {error.message}
                </div>
            ) : (!data || data.length === 0) ? (
                <div className="flex flex-col items-center justify-center p-12 bg-slate-50 border border-slate-200 border-dashed rounded-xl">
                    <Package className="w-12 h-12 text-slate-300 mb-4" />
                    <h2 className="text-lg font-medium text-slate-900">Aún no hay listas de precios activas</h2>
                    <p className="text-slate-500 mt-1 max-w-sm text-center">Importa tu primer listado en Excel para poblar tu catálogo con costos base y vigencia.</p>
                    <Link href="/precios/importar" className="mt-6 inline-flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-md font-medium hover:bg-slate-50 transition shadow-sm">
                        Comenzar Importación
                    </Link>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {data.map(p => (
                        <Link
                            key={p.proveedor}
                            href={`/precios/${encodeURIComponent(p.proveedor)}`}
                            className="group bg-white p-6 rounded-xl shadow-sm border border-slate-200 hover:shadow-md hover:border-indigo-300 transition-all block relative overflow-hidden"
                        >
                            <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-50 rounded-bl-full -mr-4 -mt-4 opacity-50 group-hover:bg-indigo-100 transition-colors" />
                            
                            <h3 className="text-xl font-semibold text-slate-900 group-hover:text-indigo-700 transition-colors mb-4 relative z-10">
                                {p.proveedor}
                            </h3>
                            
                            <div className="space-y-3 relative z-10">
                                <div className="flex items-center gap-3 text-sm text-slate-600">
                                    <Package className="w-4 h-4 text-indigo-500" />
                                    <span><strong className="text-slate-900">{p.skus_vigentes?.toLocaleString() ?? 0}</strong> SKUs registrados</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-slate-600">
                                    <Clock className="w-4 h-4 text-emerald-500" />
                                    <span>Última act.: <strong>{fmtFecha(p.ultima_importacion)}</strong></span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-slate-600">
                                    <Calendar className="w-4 h-4 text-amber-500" />
                                    <span>Lotes históricos: <strong>{p.total_importaciones ?? 0}</strong></span>
                                </div>
                            </div>

                            <div className="mt-6 flex items-center text-sm font-medium text-indigo-600 group-hover:text-indigo-700">
                                Gestionar precios
                                <ArrowRight className="w-4 h-4 ml-1 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
