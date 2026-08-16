import { supabaseAdmin } from '@/lib/supabase';
import { ReglaForm } from '@/components/precios/ReglaForm';

export default async function ReglasProveedorPage(props: { params: Promise<{ proveedor: string }> }) {
    const params = await props.params;
    const proveedorDecoded = decodeURIComponent(params.proveedor);

    // Get the rule for this provider (if any)
    const { data: reglas } = await supabaseAdmin
        .from('reglas_precio')
        .select('*')
        .eq('proveedor', proveedorDecoded)
        .limit(1);

    const regla = reglas?.[0] || {
        proveedor: proveedorDecoded,
        margen_porcentaje: 20,
        costos_fijos: 0,
        // we can expand this with more fields for retention, iva, rounding etc
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 relative p-8 max-w-4xl mx-auto">
            <div className="mb-6">
                <h2 className="text-2xl font-bold text-slate-900">Reglas de Rentabilidad</h2>
                <p className="text-slate-500 mt-1">Configura el margen deseado, las retenciones y comisiones aplicables a los productos de {proveedorDecoded}.</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8">
                {/* @ts-ignore */}
                <ReglaForm regla={regla} isGlobal={false} />
            </div>
        </div>
    );
}
