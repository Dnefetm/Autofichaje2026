'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function ActualizarContrasenaPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sb = supabaseBrowser();
    // Mantener la suscripción para que el cliente procese el token del enlace
    // (evento PASSWORD_RECOVERY) antes de permitir guardar la contraseña.
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) {
        setReady(true);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError('No se pudo actualizar. El enlace pudo expirar; pide uno nuevo.');
      return;
    }
    router.push('/login');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius)] p-6 space-y-4"
      >
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-[var(--text)]">Nueva contraseña</h1>
          <p className="text-sm text-[var(--text-muted)]">Escribe tu nueva contraseña.</p>
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-xs text-[var(--text-muted)]">Contraseña</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </div>

        {error && <p className="text-sm text-[var(--err)]">{error}</p>}

        <button
          type="submit"
          disabled={loading || !ready}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-ink)] font-medium disabled:opacity-60"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Guardar contraseña
        </button>
      </form>
    </div>
  );
}
