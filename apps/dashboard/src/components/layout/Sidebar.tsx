import React from 'react';
import Link from 'next/link';
import { LayoutDashboard, Database, Activity, Settings, Package, PlusCircle, RefreshCcw, Store } from 'lucide-react';

export default function Sidebar() {
    const menuItems = [
        { name: 'Dashboard', icon: LayoutDashboard, href: '/' },
        { name: 'Catálogo Maestro', icon: Package, href: '/catalog' },
        { name: 'Vitrinas MeLi', icon: Store, href: '/catalog/virtual' },
        { name: 'Crear con IA', icon: PlusCircle, href: '/autoficha' },
        { name: 'Monitor Sync', icon: Activity, href: '/monitor' },
        { name: 'Operaciones', icon: Database, href: '/operations' },
        { name: 'Cuentas', icon: Settings, href: '/settings' },
    ];

    return (
        <aside className="w-64 bg-slate-900 text-white flex-shrink-0 flex flex-col h-full border-r border-slate-800">
            <div className="p-6 flex items-center gap-3">
                <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
                    <RefreshCcw className="w-5 h-5" />
                </div>
                <h1 className="text-xl font-bold tracking-tight">GESTOR</h1>
            </div>

            <nav className="flex-1 px-4 py-4 space-y-1">
                {menuItems.map((item) => (
                    <Link
                        key={item.name}
                        href={item.href}
                        className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md hover:bg-slate-800 transition-colors group"
                    >
                        <item.icon className="w-4 h-4 text-slate-400 group-hover:text-indigo-400" />
                        {item.name}
                    </Link>
                ))}
            </nav>

            <div className="p-4 border-t border-slate-800">
                <div className="flex items-center gap-3 px-3 py-2">
                    <div className="w-8 h-8 bg-slate-700 rounded-full flex items-center justify-center text-xs">
                        OP
                    </div>
                    <div>
                        <p className="text-sm font-medium">Operador 1</p>
                        <p className="text-xs text-slate-500">Cerrar sesión</p>
                    </div>
                </div>
            </div>
        </aside>
    );
}
