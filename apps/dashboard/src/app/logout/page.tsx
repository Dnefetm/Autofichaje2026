'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    supabaseBrowser()
      .auth.signOut()
      .finally(() => {
        router.replace('/login');
      });
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] text-[var(--text-muted)] text-sm">
      Cerrando sesión…
    </div>
  );
}
