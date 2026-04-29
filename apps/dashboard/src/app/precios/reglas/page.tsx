import { supabaseAdmin } from '@/lib/supabase';
import { ReglaForm } from '@/components/precios/ReglaForm';

export default async function ReglasPage() {
    const { data: reglas } = await supabaseAdmin.from('reglas_precio').select('*').order('prioridad', { ascending: false });

    return (
        <div className="p-8 h-screen overflow-auto bg-slate-50">
            <h1 className="text-2xl font-bold mb-6 text-slate-900">Reglas de Pricing</h1>
            
            <div className="bg-white p-6 rounded-lg shadow mb-8">
                <h2 className="text-lg font-medium mb-4 text-slate-800">Crear Nueva Regla</h2>
                <ReglaForm />
            </div>

            <div className="bg-white rounded-lg shadow overflow-hidden">
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-sm font-medium text-slate-500">Nombre</th>
                            <th className="px-6 py-3 text-left text-sm font-medium text-slate-500">Canal</th>
                            <th className="px-6 py-3 text-left text-sm font-medium text-slate-500">Margen %</th>
                            <th className="px-6 py-3 text-left text-sm font-medium text-slate-500">Costo Fijo</th>
                            <th className="px-6 py-3 text-left text-sm font-medium text-slate-500">Activa</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                        {reglas?.map(r => (
                            <tr key={r.id}>
                                <td className="px-6 py-4 font-medium">{r.nombre}</td>
                                <td className="px-6 py-4">{r.canal}</td>
                                <td className="px-6 py-4">{r.margen_pct}%</td>
                                <td className="px-6 py-4">${r.costos_fijos}</td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${r.activa ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                        {r.activa ? 'Sí' : 'No'}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
