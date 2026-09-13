'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type Usuario = {
  id: string;
  nombre: string | null;
  rol: string;
  operador_id: string | null;
  vendedor_id: string | null;
  cliente_id: string | null;
  activo: boolean;
};
type AuthUser = { id: string; email: string };
type Opt = { id: string; nombre: string };

const ROL_LABEL: Record<string, string> = {
  admin: 'Administrador',
  vendedor_propio: 'Vendedor propio',
  vendedor_tercero: 'Vendedor tercero',
  operador: 'Operador',
  cliente: 'Cliente',
};

export default function AdminUsuariosPage() {
  const [data, setData] = useState<{
    roles: string[];
    authUsers: AuthUser[];
    usuarios: Usuario[];
    operadores: Opt[];
    vendedores: Opt[];
    clientes: Opt[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState('');
  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState('operador');
  const [operadorId, setOperadorId] = useState('');
  const [vendedorId, setVendedorId] = useState('');
  const [clienteId, setClienteId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/usuarios');
    if (!res.ok) {
      setError('No se pudo cargar. ¿Ya aplicaste la migración de la tabla `usuarios`?');
      return;
    }
    setError(null);
    setData(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch('/api/admin/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: userId,
        nombre: nombre || null,
        rol,
        operador_id: operadorId || null,
        vendedor_id: vendedorId || null,
        cliente_id: clienteId || null,
        activo: true,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j?.error || 'Error al guardar');
      return;
    }
    toast.success('Rol asignado');
    setNombre('');
    setOperadorId('');
    setVendedorId('');
    setClienteId('');
    load();
  }

  if (error) {
    return <div className="p-6 text-[var(--err)] text-sm">{error}</div>;
  }
  if (!data) {
    return (
      <div className="p-6 flex items-center gap-2 text-[var(--text-muted)] text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-lg font-semibold text-[var(--text)]">Usuarios y roles</h1>
        <p className="text-sm text-[var(--text-muted)]">Asigna un rol a cada cuenta de login.</p>
      </div>

      <form
        onSubmit={save}
        className="bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius)] p-4 space-y-3"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-[var(--text-muted)]">Usuario (email)</label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
              className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
            >
              <option value="">Selecciona…</option>
              {data.authUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-[var(--text-muted)]">Nombre (opcional)</label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-[var(--text-muted)]">Rol</label>
            <select
              value={rol}
              onChange={(e) => setRol(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
            >
              {data.roles.map((r) => (
                <option key={r} value={r}>
                  {ROL_LABEL[r] ?? r}
                </option>
              ))}
            </select>
          </div>

          {rol === 'operador' && (
            <div className="space-y-1">
              <label className="text-xs text-[var(--text-muted)]">Operador</label>
              <select
                value={operadorId}
                onChange={(e) => setOperadorId(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
              >
                <option value="">—</option>
                {data.operadores.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}

          {(rol === 'vendedor_propio' || rol === 'vendedor_tercero') && (
            <div className="space-y-1">
              <label className="text-xs text-[var(--text-muted)]">Vendedor</label>
              <select
                value={vendedorId}
                onChange={(e) => setVendedorId(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
              >
                <option value="">—</option>
                {data.vendedores.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}

          {rol === 'cliente' && (
            <div className="space-y-1">
              <label className="text-xs text-[var(--text-muted)]">Cliente</label>
              <select
                value={clienteId}
                onChange={(e) => setClienteId(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
              >
                <option value="">—</option>
                {data.clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={saving || !userId}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-ink)] font-medium disabled:opacity-60"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Guardar rol
        </button>
      </form>

      <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {data.usuarios.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-[var(--text-faint)]">
                  Sin usuarios asignados aún.
                </td>
              </tr>
            )}
            {data.usuarios.map((u) => (
              <tr key={u.id} className="border-b border-[var(--border)] last:border-0">
                <td className="px-3 py-2 text-[var(--text)]">{u.nombre ?? '—'}</td>
                <td className="px-3 py-2 text-[var(--text)]">{ROL_LABEL[u.rol] ?? u.rol}</td>
                <td className="px-3 py-2">
                  {u.activo ? (
                    <span className="text-[var(--ok)]">activo</span>
                  ) : (
                    <span className="text-[var(--text-faint)]">inactivo</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
