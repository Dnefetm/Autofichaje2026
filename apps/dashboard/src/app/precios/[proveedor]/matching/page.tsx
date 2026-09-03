import { redirect } from 'next/navigation';

// Pantalla en desuso: la confirmación de matching se hace en el wizard global
// /precios/matching (componentes PasoMapear/PasoRevisar). Esta ruta solo redirige
// para no dejar botones muertos que confundan.
export default async function MatchingPage(props: { params: Promise<{ proveedor: string }>, searchParams: Promise<any> }) {
    const searchParams = await props.searchParams;
    const importacionId = searchParams.importacion_id;

    if (importacionId) {
        redirect(`/precios/matching?importacion_id=${encodeURIComponent(importacionId)}`);
    }

    return (
        <div className="p-12 text-center text-[var(--text-muted)]">
            <p className="text-lg font-semibold mb-2">Esta pantalla está en desuso</p>
            <p className="text-sm">La revisión de matching se realiza desde el asistente de importación.</p>
        </div>
    );
}
