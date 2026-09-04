import { ReglaForm } from '@/components/precios/ReglaForm';

export default async function ReglasProveedorPage(props: { params: Promise<{ proveedor: string }> }) {
    const params = await props.params;
    const proveedorDecoded = decodeURIComponent(params.proveedor);

    return (
        <div className="flex flex-col h-full bg-[var(--bg)] relative p-8 max-w-4xl mx-auto">
            <div className="mb-6">
                <h2 className="text-2xl font-bold text-[var(--text)]">Reglas de Rentabilidad</h2>
                <p className="text-[var(--text-muted)] mt-1">Configura el margen deseado, las retenciones y comisiones aplicables a los productos de {proveedorDecoded}.</p>
            </div>

            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-sm p-8">
                <ReglaForm />
            </div>
        </div>
    );
}
