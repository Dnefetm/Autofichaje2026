'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function RecuperarPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/actualizar-contrasena`,
    });
    setLoading(false);
    if (error) {
      setError('No se pudo enviar el correo. Verifica el email e intenta de nuevo.');
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
        <div className="w-full max-w-sm bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius)] p-6 space-y-3 text-center">
          <h1 className="text-lg font-semibold text-[var(--text)]">Revisa tu email</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Te enviamos un enlace para restablecer tu contraseña.
          </p>
          <Link
            href="/login"
            className="inline-block w-full px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-ink)] font-medium"
          >
            Volver a iniciar sesión
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius)] p-6 space-y-4"
      >
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-[var(--text)]">Recuperar contraseña</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Escribe tu email y te mandamos un enlace para restablecerla.
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="email" className="text-xs text-[var(--text-muted)]">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </div>

        {error && <p className="text-sm text-[var(--err)]">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-ink)] font-medium disabled:opacity-60"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Enviar enlace
        </button>

        <p className="text-xs text-[var(--text-muted)] text-center">
          <Link href="/login" className="text-[var(--accent)] hover:underline">
            Volver a iniciar sesión
          </Link>
        </p>
      </form>
    </div>
  );
}
