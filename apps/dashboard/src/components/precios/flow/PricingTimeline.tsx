'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { usePricingFlowState } from './usePricingFlowState';
import { Check, AlertTriangle, Circle, Minus } from 'lucide-react';

export function PricingTimeline({ proveedor }: { proveedor: string }) {
    const pathname = usePathname();
    const router = useRouter();
    const { flowState, isLoading } = usePricingFlowState(proveedor);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
            if (isTyping) return;
            
            if (['1','2','3'].includes(e.key)) {
                e.preventDefault();
                const routes = ['subir', 'revisar', 'aplicar'];
                router.push(`/precios/${encodeURIComponent(proveedor)}/${routes[+e.key-1]}`);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [proveedor, router]);

    const activeStep = pathname.includes('/subir') ? 1 :
                       pathname.includes('/revisar') ? 2 :
                       pathname.includes('/aplicar') ? 3 : 0;

    const renderNode = (stepNum: number, label: string, route: string, stateObj: any) => {
        const isActive = activeStep === stepNum;
        let state = stateObj?.state || 'pending';
        if (isActive && state !== 'attention') state = 'active';

        const colorMap: any = {
            done: 'text-emerald-500 border-emerald-500',
            attention: 'text-amber-500 border-amber-500',
            active: 'text-indigo-500 border-indigo-500 font-bold',
            pending: 'text-slate-400 border-slate-300',
            skip: 'text-slate-300 border-slate-200'
        };

        const Icon = state === 'done' ? Check :
                     state === 'attention' ? AlertTriangle :
                     state === 'skip' ? Minus : Circle;

        const isFilled = state === 'active' || state === 'done' || state === 'attention';

        return (
            <Link href={`/precios/${encodeURIComponent(proveedor)}/${route}`} className="flex flex-col items-center group relative z-10 w-24">
                <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center bg-white transition-colors ${colorMap[state]} ${isActive ? 'ring-4 ring-indigo-50' : ''}`}>
                    <Icon className={`w-4 h-4 ${isFilled && state !== 'skip' ? 'fill-current' : ''}`} strokeWidth={state === 'active' ? 3 : 2} />
                </div>
                <div className={`mt-2 text-sm ${isActive ? 'font-bold text-slate-900' : 'font-medium text-slate-600'} flex items-center`}>
                    <span className="text-slate-300 text-xs mr-1 opacity-0 group-hover:opacity-100 transition-opacity">{stepNum}</span> {label}
                </div>
                <div className="text-xs text-slate-400 mt-0.5 text-center px-1">
                    {stateObj?.subtitle || (isLoading ? 'Cargando...' : '')}
                </div>
            </Link>
        );
    };

    return (
        <div className="bg-white border-b border-slate-200 py-6 px-8 flex justify-center w-full shadow-sm">
            <div className="relative flex items-start justify-between w-full max-w-2xl">
                {/* Connecting Line */}
                <div className="absolute top-4 left-12 right-12 h-0.5 bg-slate-200 z-0"></div>
                
                {renderNode(1, 'Subir', 'subir', flowState?.step1)}
                {renderNode(2, 'Revisar', 'revisar', flowState?.step2)}
                {renderNode(3, 'Aplicar', 'aplicar', flowState?.step3)}
            </div>
        </div>
    );
}
