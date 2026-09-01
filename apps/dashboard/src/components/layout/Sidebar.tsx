'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import {
    LayoutDashboard, Database, Activity, Settings,
    Package, PlusCircle, RefreshCcw, Store,
    ChevronLeft, ChevronRight, ShoppingCart, FileText,
    Upload, ClipboardList,
} from 'lucide-react';

export default function Sidebar({ mobileOpen = false, onCloseMobile }: {
    mobileOpen?: boolean;
    onCloseMobile?: () => void;
}) {
    const pathname = usePathname();
    const [pendingCount, setPendingCount] = useState<number | null>(null);
    const [collapsed, setCollapsed] = useState(false);
    const [isDesktop, setIsDesktop] = useState(true);

    // Detectar escritorio vs móvil (breakpoint md = 768px)
    useEffect(() => {
        const mq = window.matchMedia('(min-width: 768px)');
        const handler = () => setIsDesktop(mq.matches);
        handler();
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    useEffect(() => {
        let cancel = false;
        async function fetchCount() {
            const { count } = await supabase
                .from('publicaciones_externas')
                .select('id', { count: 'exact', head: true })
                .or('esta_mapeado.is.null,esta_mapeado.eq.false')
                .eq('external_variation_id', '0');
            if (!cancel) setPendingCount(count ?? 0);
        }
        fetchCount();
        const t = setInterval(fetchCount, 60_000);
        return () => {
            cancel = true;
            clearInterval(t);
        };
    }, []);

    // Persistir preferencia de colapso (solo aplica en escritorio)
    useEffect(() => {
        const saved = localStorage.getItem('sidebar-collapsed');
        if (saved === 'true') setCollapsed(true);
    }, []);

    function toggle() {
        const next = !collapsed;
        setCollapsed(next);
        localStorage.setItem('sidebar-collapsed', String(next));
    }

    // En móvil el drawer siempre muestra etiquetas; el colapso es solo de escritorio.
    const showLabels = isDesktop ? !collapsed : true;

    const menuItems = [
        { name: 'Dashboard',        icon: LayoutDashboard, href: '/' },
        { name: 'Catálogo Maestro', icon: Package,         href: '/catalog' },
        { name: 'Vitrinas MeLi',   icon: Store,            href: '/catalog/external' },
        { name: 'Ventas',           icon: ShoppingCart,    href: '/ventas' },
        { name: 'Crear con IA',     icon: PlusCircle,      href: '/autoficha' },
        { name: 'Fichas Técnicas',  icon: FileText,        href: '/fichas' },
        { name: 'Precios',          icon: Upload,          href: '/precios' },
        { name: 'Monitor Sync',     icon: Activity,        href: '/monitor' },
        { name: 'Operaciones',      icon: Database,        href: '/operations' },
        { name: 'Cuentas',          icon: Settings,        href: '/settings' },
    ];

    const isPendientesActive = pathname === '/catalog/external/pendientes';

    return (
        <aside className={cn(
            'bg-[var(--surface-2)] text-[var(--text)] flex-shrink-0 flex flex-col h-full border-r border-[var(--border)] transition-transform duration-200 select-none',
            // ancho: drawer móvil fijo 64, escritorio 56/16 según colapso
            collapsed && isDesktop ? 'w-16' : 'w-64 md:w-56',
            // posición: drawer fijo en móvil, estático en escritorio
            'fixed inset-y-0 left-0 z-50 md:static md:z-auto',
            // deslizar: oculto fuera de pantalla en móvil, visible en escritorio
            mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}>
            {/* Header con Logo y Botón Toggle Integrado (toggle solo escritorio) */}
            <div className={cn(
                'p-3 border-b border-[var(--border)] flex items-center',
                showLabels ? 'justify-between' : 'justify-center flex-col gap-2'
            )}>
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 shrink-0 bg-[var(--accent)] text-[var(--accent-ink)] rounded-lg flex items-center justify-center shadow-sm">
                        <RefreshCcw className="w-4 h-4" />
                    </div>
                    {showLabels && (
                        <span className="text-base font-bold tracking-tight text-[var(--text)] truncate">
                            GESTOR
                        </span>
                    )}
                </div>

                <button
                    onClick={toggle}
                    title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
                    className="hidden md:flex p-1.5 rounded-md hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                >
                    {collapsed
                        ? <ChevronRight className="w-4 h-4" />
                        : <ChevronLeft  className="w-4 h-4" />
                    }
                </button>
            </div>

            {/* Navegación */}
            <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto" onClick={onCloseMobile}>
                {menuItems.map((item) => {
                    const isActive = item.href === '/'
                        ? pathname === '/'
                        : pathname.startsWith(item.href) && !pathname.startsWith('/catalog/external/pendientes');

                    return (
                        <Link
                            key={item.name}
                            href={item.href}
                            title={showLabels ? undefined : item.name}
                            className={cn(
                                'flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors group',
                                !showLabels && 'justify-center px-2',
                                isActive
                                    ? 'bg-[var(--accent)] text-[var(--accent-ink)] font-semibold shadow-sm'
                                    : 'text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]'
                            )}
                        >
                            <item.icon className={cn(
                                'w-4 h-4 shrink-0 transition-colors',
                                isActive ? 'text-[var(--accent-ink)]' : 'text-[var(--text-faint)] group-hover:text-[var(--text)]'
                            )} />
                            {showLabels && <span className="truncate">{item.name}</span>}
                        </Link>
                    );
                })}

                {/* Enlace de Pendientes con Notificación */}
                <Link
                    href="/catalog/external/pendientes"
                    title={showLabels ? undefined : `Pendientes (${pendingCount ?? 0})`}
                    className={cn(
                        'flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors group relative',
                        !showLabels && 'justify-center px-2',
                        isPendientesActive
                            ? 'bg-[var(--accent)] text-[var(--accent-ink)] font-semibold shadow-sm'
                            : 'text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]'
                    )}
                >
                    <div className="relative">
                        <ClipboardList className={cn(
                            'w-4 h-4 shrink-0 transition-colors',
                            isPendientesActive ? 'text-[var(--accent-ink)]' : 'text-amber-400 group-hover:text-amber-300'
                        )} />
                        {!showLabels && pendingCount !== null && pendingCount > 0 && (
                            <span className="absolute -top-1 -right-1.5 w-2.5 h-2.5 bg-[var(--warn)] rounded-full ring-2 ring-[var(--surface-2)]" />
                        )}
                    </div>
                    {showLabels && (
                        <div className="flex items-center justify-between flex-1 min-w-0">
                            <span className="truncate">Pendientes</span>
                            {pendingCount !== null && pendingCount > 0 && (
                                <span className="px-2 py-0.5 rounded-full bg-[var(--warn)] text-slate-950 text-xs font-bold shadow-xs">
                                    {pendingCount.toLocaleString()}
                                </span>
                            )}
                        </div>
                    )}
                </Link>
            </nav>

            {/* Usuario / Footer */}
            <div className="p-3 border-t border-[var(--border)]">
                <div className={cn('flex items-center gap-3 px-1.5 py-1', !showLabels && 'justify-center')}>
                    <div className="w-8 h-8 shrink-0 bg-[var(--surface)] border border-[var(--border)] rounded-full flex items-center justify-center text-xs font-semibold text-[var(--text)]">
                        OP
                    </div>
                    {showLabels && (
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-[var(--text)] truncate">Operador 1</p>
                            <p className="text-xs text-[var(--text-muted)] truncate">Sesión activa</p>
                        </div>
                    )}
                </div>
            </div>
        </aside>
    );
}
