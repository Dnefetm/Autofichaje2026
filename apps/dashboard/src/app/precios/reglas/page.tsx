import { supabaseAdmin } from '@/lib/supabase';
import { ReglaForm } from '@/components/precios/ReglaForm';

export default async function ReglasPage() {
    const { data: reglas } = await supabaseAdmin.from('reglas_precio').select('*').order('prioridad', { ascending: false });

    return (
        <div className="p-8 h-screen overflow-auto bg-[var(--bg)]">
            <h1 className="text-2xl font-bold mb-6 text-[var(--text)]">Reglas de Pricing</h1>
            
            <div className="bg-[var(--surface)] p-6 rounded-lg shadow mb-8">
                <h2 className="text-lg font-medium mb-4 text-[var(--text)]">Crear Nueva Regla</h2>
                <ReglaForm />
            </div>

            <div className="bg-[var(--surface)] rounded-lg shadow overflow-hidden">
                <table className="min-w-full divide-y divide-[var(--border)]">
                    <thead className="bg-[var(--bg)]">
                        <tr>
                            <th className="px-6 py-3 text-left text-sm font-medium text-[var(--text-muted)]">Nombre</th>
                            <th className="px-6 py-3 text-left text-sm font-medium text-[var(--text-muted)]">Canal</th>
                            <th className="px-6 py-3 text-left text-sm font-medium text-[var(--text-muted)]">Margen %</th>
                            <th className="px-6 py-3 text-left text-sm font-medium text-[var(--text-muted)]">Costo Fijo</th>
                            <th className="px-6 py-3 text-left text-sm font-medium text-[var(--text-muted)]">Activa</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)]">
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
