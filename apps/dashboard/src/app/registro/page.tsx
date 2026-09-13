'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase-browser';

function humanError(msg: string): string {
  if (/already registered/i.test(msg)) return 'Ese email ya está registrado. Inicia sesión.';
  if (/password should be at least/i.test(msg)) return 'La contraseña debe tener al menos 6 caracteres.';
  return 'No se pudo crear la cuenta. Inténtalo de nuevo.';
}

export default function RegistroPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/login` },
    });
    if (error) {
      setError(humanError(error.message));
      setLoading(false);
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
            Te enviamos un enlace de confirmación. Ábrelo y luego inicia sesión.
          </p>
          <button
            onClick={() => router.push('/login')}
            className="w-full inline-flex items-center justify-center px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-ink)] font-medium"
          >
            Ir a iniciar sesión
          </button>
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
          <h1 className="text-lg font-semibold text-[var(--text)]">Crear cuenta</h1>
          <p className="text-sm text-[var(--text-muted)]">Regístrate para acceder al gestor.</p>
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
          disabled={loading}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-ink)] font-medium disabled:opacity-60"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Crear cuenta
        </button>

        <p className="text-xs text-[var(--text-muted)] text-center">
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" className="text-[var(--accent)] hover:underline">
            Inicia sesión
          </Link>
        </p>
      </form>
    </div>
  );
}
