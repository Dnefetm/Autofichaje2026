'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase-browser';

function humanError(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos.';
  if (/email not confirmed/i.test(msg)) return 'Confirma tu email antes de entrar.';
  if (/rate limit/i.test(msg)) return 'Demasiados intentos. Espera un momento.';
  return 'No se pudo iniciar sesión. Inténtalo de nuevo.';
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    if (error) {
      setError(humanError(error.message));
      setLoading(false);
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius)] p-6 space-y-4"
      >
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-[var(--text)]">Iniciar sesión</h1>
          <p className="text-sm text-[var(--text-muted)]">Accede al gestor con tu cuenta.</p>
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
            autoComplete="current-password"
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
          Entrar
        </button>

        <p className="text-xs text-[var(--text-muted)] text-center">
          ¿No tienes cuenta?{' '}
          <Link href="/registro" className="text-[var(--accent)] hover:underline">
            Crear una
          </Link>
        </p>
      </form>
    </div>
  );
}
