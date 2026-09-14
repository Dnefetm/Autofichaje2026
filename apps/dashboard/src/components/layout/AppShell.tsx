"use client";
import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Sidebar from './Sidebar';
import ThemeSwitcher from '@/components/ui/ThemeSwitcher';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { Menu, LogOut, LogIn } from 'lucide-react';

const AUTH_PAGES = new Set(['/login', '/registro', '/recuperar', '/actualizar-contrasena', '/logout']);

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const sb = supabaseBrowser();
    sb.auth.getUser().then(({ data }) => setLoggedIn(!!data.user));
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setLoggedIn(!!session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Páginas de auth: pantalla completa, sin sidebar.
  if (AUTH_PAGES.has(pathname)) {
    return <>{children}</>;
  }

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

      <main className="flex-1 overflow-y-auto bg-[var(--bg)] relative px-3 sm:px-6 lg:px-8 pb-8 pt-16 md:pt-8">
        {/* Botón hamburguesa solo móvil */}
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menú"
          className="fixed top-3 left-3 z-50 md:hidden p-2.5 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)]"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="absolute top-4 right-8 z-50 flex items-center gap-2">
          {loggedIn ? (
            <Link
              href="/logout"
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
              className="p-2 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              <LogOut className="w-4 h-4" />
            </Link>
          ) : (
            <Link
              href="/login"
              aria-label="Iniciar sesión"
              title="Iniciar sesión"
              className="p-2 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              <LogIn className="w-4 h-4" />
            </Link>
          )}
          <ThemeSwitcher />
        </div>

        {children}
      </main>
    </div>
  );
}
