'use client';
import useSWR from 'swr';
import { useState } from 'react';

const fetcher = (u: string) => fetch(u).then(r => r.json());

type AliasRow = {
  id: string;
  proveedor: string;
  codigo_excel: string | null;
  marca_excel: string | null;
  modelo_excel: string | null;
  articulo_id: string;
  locked: boolean;
  estado_proveedor: string;
};

export default function AliasesPage() {
  const [q, setQ] = useState('');
  const { data, mutate } = useSWR(`/api/alias?q=${encodeURIComponent(q)}`, fetcher);

  async function toggleLock(id: string, locked: boolean) {
    await fetch(`/api/alias/${id}`, {
      method: 'PATCH',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({ locked }),
    });
    mutate();
  }

  async function softDelete(id: string) {
    if (!confirm('¿Eliminar alias?')) return;
    await fetch(`/api/alias/${id}`, {
      method: 'PATCH',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({ estado_proveedor: 'eliminado' }),
    });
    mutate();
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Alias de proveedores</h1>
      <input 
        value={q} 
        onChange={e => setQ(e.target.value)}
        placeholder="Buscar por proveedor / marca / modelo / código / articulo_id"
        className="w-full border p-2 mb-4 rounded"
      />
      
      {!data ? <p>Cargando...</p> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b bg-[var(--bg)]">
              <th className="p-2">Proveedor</th>
              <th className="p-2">Código</th>
              <th className="p-2">Marca / Modelo</th>
              <th className="p-2">Artículo ID</th>
              <th className="p-2">Estado</th>
              <th className="p-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {(data as AliasRow[]).map(row => (
              <tr key={row.id} className="border-b hover:bg-[var(--bg)]">
                <td className="p-2 font-semibold">{row.proveedor}</td>
                <td className="p-2 font-mono">{row.codigo_excel || '-'}</td>
                <td className="p-2">{row.marca_excel || '-'} / {row.modelo_excel || '-'}</td>
                <td className="p-2 font-mono text-xs">{row.articulo_id}</td>
                <td className="p-2">
                  <span className={`px-2 py-1 text-xs rounded ${row.locked ? 'bg-[var(--err)]/10 text-[var(--err)]' : 'bg-[var(--ok)]/10 text-[var(--ok)]'}`}>
                    {row.locked ? 'Bloqueado (Manual)' : 'Automático'}
                  </span>
                </td>
                <td className="p-2 space-x-2">
                  <button 
                    onClick={() => toggleLock(row.id, !row.locked)}
                    className="text-[var(--info)] hover:underline"
                  >
                    {row.locked ? 'Desbloquear' : 'Bloquear'}
                  </button>
                  <button 
                    onClick={() => softDelete(row.id)}
                    className="text-[var(--err)] hover:underline"
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
