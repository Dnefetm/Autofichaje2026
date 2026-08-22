import { PricingTimeline } from '@/components/precios/flow/PricingTimeline';

export default async function ProveedorLayout(props: { children: React.ReactNode, params: Promise<{ proveedor: string }> }) {
    const params = await props.params;
    const proveedor = decodeURIComponent(params.proveedor);

    return (
        <div className="flex flex-col h-[calc(100vh-80px)] overflow-hidden bg-[var(--bg)]">
            <PricingTimeline proveedor={proveedor} />
            <div className="flex-1 overflow-auto">
                {props.children}
            </div>
        </div>
    );
}
