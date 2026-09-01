"use client";
import React, { useState } from 'react';
import Sidebar from './Sidebar';
import ThemeSwitcher from '@/components/ui/ThemeSwitcher';
import { Menu } from 'lucide-react';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />

      {/* Overlay oscuro solo en móvil, cuando el drawer está abierto */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <main className="flex-1 overflow-y-auto bg-[var(--bg)] relative px-4 sm:px-8 pb-8 pt-16 md:pt-8">
        {/* Botón hamburguesa solo móvil */}
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menú"
          className="fixed top-3 left-3 z-50 md:hidden p-2.5 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)]"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="absolute top-4 right-8 z-50">
          <ThemeSwitcher />
        </div>

        {children}
      </main>
    </div>
  );
}
