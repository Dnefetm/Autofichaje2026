'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
    LayoutDashboard, Database, Activity, Settings,
    Package, PlusCircle, RefreshCcw, Store,
    ChevronLeft, ChevronRight,
} from 'lucide-react';

export default function Sidebar() {
    const menuItems = [
        { name: 'Dashboard',       icon: LayoutDashboard, href: '/' },
        { name: 'Catálogo Maestro', icon: Package,         href: '/catalog' },
        { name: 'Vitrinas MeLi',   icon: Store,            href: '/catalog/external' },
        { name: 'Crear con IA',    icon: PlusCircle,       href: '/autoficha' },
        { name: 'Monitor Sync',    icon: Activity,         href: '/monitor' },
        { name: 'Operaciones',     icon: Database,         href: '/operations' },
        { name: 'Cuentas',         icon: Settings,         href: '/settings' },
    ];

    const [collapsed, setCollapsed] = useState(false);

    // Persistir preferencia en localStorage
    useEffect(() => {
        const saved = localStorage.getItem('sidebar-collapsed');
        if (saved === 'true') setCollapsed(true);
    }, []);

    function toggle() {
        const next = !collapsed;
        setCollapsed(next);
        localStorage.setItem('sidebar-collapsed', String(next));
    }

    return (
        <aside className={cn(
            'bg-slate-900 text-white flex-shrink-0 flex flex-col h-full border-r border-slate-800 transition-all duration-200',
            collapsed ? 'w-16' : 'w-64'
        )}>
            {/* Logo */}
            <div className={cn('p-4 flex items-center gap-3', collapsed && 'justify-center')}>
                <div className="w-8 h-8 shrink-0 bg-indigo-500 rounded-lg flex items-center justify-center">
                    <RefreshCcw className="w-5 h-5" />
                </div>
                {!collapsed && <h1 className="text-xl font-bold tracking-tight">GESTOR</h1>}
            </div>

            {/* Nav */}
            <nav className="flex-1 px-2 py-4 space-y-1">
                {menuItems.map((item) => (
                    <Link
                        key={item.name}
                        href={item.href}
                        title={item.name}
                        className={cn(
                            'flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md hover:bg-slate-800 transition-colors group',
                            collapsed && 'justify-center'
                        )}
                    >
                        <item.icon className="w-4 h-4 shrink-0 text-slate-400 group-hover:text-indigo-400" />
                        {!collapsed && <span>{item.name}</span>}
                    </Link>
                ))}
            </nav>

            {/* Usuario */}
            <div className="p-3 border-t border-slate-800">
                <div className={cn('flex items-center gap-3 px-2 py-2', collapsed && 'justify-center')}>
                    <div className="w-8 h-8 shrink-0 bg-slate-700 rounded-full flex items-center justify-center text-xs">
                        OP
                    </div>
                    {!collapsed && (
                        <div>
                            <p className="text-sm font-medium">Operador 1</p>
                            <p className="text-xs text-slate-500">Cerrar sesión</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Botón toggle */}
            <button
                onClick={toggle}
                title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
                className="flex items-center justify-center py-3 border-t border-slate-800 hover:bg-slate-800 transition-colors text-slate-400 hover:text-white"
            >
                {collapsed
                    ? <ChevronRight className="w-4 h-4" />
                    : <ChevronLeft  className="w-4 h-4" />
                }
            </button>
        </aside>
    );
}
