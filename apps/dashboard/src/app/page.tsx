"use client";

import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  AlertTriangle,
  Package,
  TrendingUp,
  Clock,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { dashboardService } from '@/lib/dashboard-service';

export default function DashboardPage() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const stats = [
    { label: 'Ventas Hoy', value: '$12,450', change: '+12%', trend: 'up', icon: TrendingUp, color: 'text-[var(--ok)]', bg: 'bg-[var(--ok)]/10' },
    { label: 'Stock Crítico', value: alerts.filter(a => a.level === 'critical' || a.level === 'warning').length.toString(), change: 'Actualizado', trend: 'neutral', icon: AlertTriangle, color: 'text-[var(--err)]', bg: 'bg-[var(--err)]/10' },
    { label: 'Jobs en Cola', value: '18', change: 'En tiempo real', trend: 'neutral', icon: Clock, color: 'text-[var(--accent)]', bg: 'bg-[var(--accent)]/10' },
    { label: 'Items Sincronizados', value: '142', change: '+5', trend: 'up', icon: Package, color: 'text-[var(--info)]', bg: 'bg-[var(--info)]/10' },
  ];

  useEffect(() => {
    async function loadAlerts() {
      try {
        const data = await dashboardService.getActiveAlerts();
        if (data && data.length > 0) {
          setAlerts(data);
        } else {
          // MOCK Fallback
          setAlerts([
            { id: '1', level: 'critical', message: 'MOCK: STOCK AGOTADO en HERR-001', created_at: new Date().toISOString(), sku: 'HERR-001' },
            { id: '2', level: 'warning', message: 'MOCK: Stock crítico en HERR-002', created_at: new Date(Date.now() - 3600000).toISOString(), sku: 'HERR-002' },
          ]);
        }
      } catch (err) {
        console.error('Error loading alerts:', err);
      } finally {
        setLoading(false);
      }
    }
    loadAlerts();
  }, []);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-[var(--text)]">Bienvenido, Operador</h2>
          <p className="text-[var(--text-muted)] text-sm">Resumen operativo de tus cuentas de Marketplace.</p>
        </div>
        <div className="text-xs text-[var(--text-faint)] font-mono">
          Última actualización: {new Date().toLocaleTimeString()}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-[var(--surface)] p-6 rounded-xl border border-[var(--border)] shadow-sm">
            <div className="flex justify-between items-start mb-4">
              <div className={cn("p-2 rounded-lg", stat.bg)}>
                <stat.icon className={cn("w-5 h-5", stat.color)} />
              </div>
              {stat.trend !== 'neutral' && (
                <div className={cn(
                  "flex items-center text-xs font-bold px-2 py-1 rounded-full",
                  stat.trend === 'up' ? "bg-[var(--ok)]/10 text-[var(--ok)]" : "bg-[var(--err)]/10 text-[var(--err)]"
                )}>
                  {stat.trend === 'up' ? <ArrowUpRight className="w-3 h-3 mr-1" /> : <ArrowDownRight className="w-3 h-3 mr-1" />}
                  {stat.change}
                </div>
              )}
            </div>
            <p className="text-sm font-medium text-[var(--text-muted)]">{stat.label}</p>
            <h3 className="text-2xl font-bold text-[var(--text)]">{stat.value}</h3>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Alertas Críticas */}
        <div className="lg:col-span-2 bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-sm overflow-hidden text-sm">
          <div className="px-6 py-4 border-b border-[var(--border)] flex justify-between items-center bg-[var(--bg)]/50">
            <h3 className="font-bold text-[var(--text)] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[var(--err)]" />
              Alertas de Sistema e Inventario
            </h3>
            <button className="text-xs font-bold text-[var(--accent)] hover:text-[var(--accent)]">Historial</button>
          </div>
          <div className="divide-y divide-[var(--border)] min-h-[200px]">
            {loading && alerts.length === 0 ? (
              <div className="p-8 text-center text-[var(--text-faint)]">Cargando alertas...</div>
            ) : alerts.length === 0 ? (
              <div className="p-12 text-center">
                <Package className="w-12 h-12 text-[var(--text-faint)] mx-auto mb-3" />
                <p className="text-[var(--text-faint)]">No hay alertas activas de momento.</p>
              </div>
            ) : alerts.map((alert) => (
              <div key={alert.id} className="px-6 py-4 flex items-center justify-between hover:bg-[var(--bg)]/80 transition-colors">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-2.5 h-2.5 rounded-full shadow-sm",
                    alert.level === 'critical' ? "bg-[var(--err)]/100 animate-pulse" :
                      alert.level === 'warning' ? "bg-[var(--warn)]/100" : "bg-[var(--info)]/100"
                  )} />
                  <div>
                    <p className="font-semibold text-[var(--text)]">{alert.message}</p>
                    <p className="text-[10px] text-[var(--text-faint)] uppercase tracking-tight">
                      {new Date(alert.created_at).toLocaleString()} • SKU: {alert.sku || '-'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="px-3 py-1 text-xs border border-[var(--border)] rounded-md hover:bg-[var(--surface-2)] font-bold transition-all">Gestionar</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Actividad de Marketplace */}
        <div className="space-y-6">
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-sm p-6">
            <h3 className="font-bold text-[var(--text)] mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[var(--ok)]" />
              Salud de Cuentas
            </h3>
            <div className="space-y-4">
              <MarketplaceHealth name="Mercado Libre MX" health={98} />
              <MarketplaceHealth name="Amazon MX" health={100} />
              <div className="pt-4 mt-6 border-t border-[var(--border)]">
                <div className="bg-[var(--bg)] rounded-lg p-4">
                  <h4 className="text-xs font-bold text-[var(--text-muted)] uppercase mb-2">Resumen Operativo</h4>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                    Todos los servicios operando normalmente. Latencia de MeLi: <span className="text-[var(--ok)] font-bold">120ms</span>.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Lógica de Packs (Real Action) */}
          <div className="bg-[var(--accent)]/20 text-[var(--accent-ink)] rounded-xl shadow-lg p-6 overflow-hidden relative group">
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-[var(--surface)]/10 rounded-full blur-2xl group-hover:scale-150 transition-all duration-700" />
            <h4 className="font-bold mb-3 flex items-center gap-2">
              <Package className="w-4 h-4 text-[var(--text-faint)]" />
              Motor de Packs Activo
            </h4>
            <p className="text-xs text-[var(--text)] leading-relaxed mb-4">
              El sistema detecta automáticamente que tus publicaciones de "Packs" dependen de múltiples productos.
              Calculamos el stock basándonos en el **componente con menor existencia**.
            </p>
            <div className="bg-[var(--surface)]/10 rounded-lg p-3 text-[10px] space-y-2 font-mono">
              <div className="flex justify-between">
                <span className="text-[var(--text-faint)] italic">Pack A (1 Martillo + 2 Taladros)</span>
              </div>
              <div className="h-px bg-[var(--surface)]/5" />
              <div className="flex justify-between">
                <span>Martillo Stock: 10</span>
                <span className="text-[var(--ok)]">OK</span>
              </div>
              <div className="flex justify-between">
                <span>Taladro Stock: 1</span>
                <span className="text-[var(--err)]">BAJO</span>
              </div>
              <div className="flex justify-between font-bold border-t border-[var(--border)]/30 pt-1 mt-1">
                <span className="text-[var(--accent-ink)]">STOCK EN MeLi:</span>
                <span className="text-[var(--warn)] uppercase">0 Unidades</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MarketplaceHealth({ name, health }: { name: string, health: number }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs font-semibold">
        <span className="text-[var(--text-muted)]">{name}</span>
        <span className={cn(health > 95 ? "text-[var(--ok)]" : "text-[var(--warn)]")}>{health}% OK</span>
      </div>
      <div className="h-1.5 w-full bg-[var(--surface-2)] rounded-full overflow-hidden">
        <div
          className={cn("h-full transition-all duration-1000", health > 95 ? "bg-[var(--ok)]/100" : "bg-[var(--warn)]/100")}
          style={{ width: `${health}%` }}
        />
      </div>
    </div>
  );
}
