import { supabaseAdmin } from '@/lib/supabase';
import { ProveedorTabs } from '@/components/precios/ProveedorTabs';

export default async function ProveedorLayout(props: { children: React.ReactNode, params: Promise<{ proveedor: string }> }) {
    const params = await props.params;
    const proveedor = decodeURIComponent(params.proveedor);

    // Último lote (vigente o más reciente) para el enlace directo a Vinculación.
    let importacionId: string | null = null;
    const { data: vigente } = await supabaseAdmin
        .from('listas_precios_proveedor')
        .select('importacion_id')
        .eq('proveedor', proveedor)
        .eq('vigente', true)
        .order('creado_el', { ascending: false })
        .limit(1);
    importacionId = vigente?.[0]?.importacion_id ?? null;
    if (!importacionId) {
        const { data: ultimo } = await supabaseAdmin
            .from('importaciones_excel')
            .select('id')
            .eq('proveedor', proveedor)
            .order('creado_el', { ascending: false })
            .limit(1);
        importacionId = ultimo?.[0]?.id ?? null;
    }

    return (
        <div className="flex flex-col h-[calc(100vh-80px)] overflow-hidden bg-[var(--bg)]">
            <ProveedorTabs proveedor={proveedor} importacionId={importacionId} />
            <div className="flex-1 overflow-auto">
                {props.children}
            </div>
        </div>
    );
}
