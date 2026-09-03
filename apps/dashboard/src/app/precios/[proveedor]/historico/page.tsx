import { redirect } from 'next/navigation';

// "Historico" era un duplicado de "Historial". Redirigimos a la página canónica
// para evitar dos pantallas casi idénticas y enlaces muertos.
export default async function HistoricoPage(props: { params: Promise<{ proveedor: string }> }) {
    const params = await props.params;
    const proveedorDecoded = decodeURIComponent(params.proveedor);
    redirect(`/precios/${encodeURIComponent(proveedorDecoded)}/historial`);
}
