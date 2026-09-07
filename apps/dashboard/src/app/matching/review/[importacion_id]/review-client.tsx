'use client';
import { toast } from 'sonner';

import { useMemo, useState } from 'react';
import useSWR from 'swr';

type Row = {
  md_id: string; nivel: 1|2|3|4|5; gtin: string|null;
  marca_excel: string|null; modelo_excel: string|null;
  proveedor: string; candidatos: Array<{articulo_id: string; nombre: string; score: number}>;
  articulo_id_final: string|null; confirmado: boolean; gtin_dupes: number;
};

const fetcher = (u: string) => fetch(u).then(r => r.json());

export function ReviewClient({ importacionId, rows }: { importacionId: string; rows: Row[] }) {
  const [tab, setTab]     = useState<'A'|'B'|'C'|'D'>('A');
  const [sel, setSel]     = useState<Record<string, string>>({});  // md_id -> articulo_id
  const [jobId, setJobId] = useState<string | null>(null);

  const buckets = useMemo(() => ({
    A: rows.filter(r => r.nivel === 1 && !r.confirmado),
    B: rows.filter(r => (r.nivel === 2 || r.nivel === 3) && !r.confirmado),
    C: rows.filter(r => r.nivel === 4 && !r.confirmado),
    D: rows.filter(r => r.nivel === 5 && !r.confirmado),
  }), [rows]);

  const { data: jobStatus } = useSWR(
    jobId ? `/api/matching/jobs/${jobId}` : null,
    fetcher,
    { refreshInterval: (d: any) => (d?.status === 'done' || d?.status === 'failed') ? 0 : 2000 },
  );

  async function submit(rowsToConfirm: Row[]) {
    const decisiones = rowsToConfirm
      .filter(r => sel[r.md_id] ?? r.candidatos?.[0]?.articulo_id)
      .map(r => ({ md_id: r.md_id, articulo_id: sel[r.md_id] ?? r.candidatos[0].articulo_id }));

    if (!decisiones.length) return;

    const res = await fetch('/api/matching/confirm-batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ importacion_id: importacionId, decisiones }),
    });
    const json = await res.json();
    if (res.ok) setJobId(json.job_id);
    else toast.error(`Error: ${json.error}`);
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Revisión de matching</h1>

      {jobStatus && (
        <div className="mb-4 p-3 rounded bg-[var(--bg)] border">
          Job <code>{jobStatus.id?.slice(0,8)}</code> — <b>{jobStatus.status}</b>
          {' '}({jobStatus.processed}/{jobStatus.total} — {jobStatus.alias_aprendidos} alias nuevos)
          {jobStatus.error && <span className="text-[var(--err)]"> · {jobStatus.error}</span>}
        </div>
      )}

      <nav className="flex gap-2 mb-4">
        {(['A','B','C','D'] as const).map(k => (
          <button key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-1 rounded ${tab===k?'bg-[var(--accent)] text-[var(--accent-ink)]':'bg-[var(--surface-2)]'}`}>
            {k} · {k==='A'?'GTIN exacto':k==='B'?'Candidatos':k==='C'?'Ambigüedad':'Sin candidato'}
            {' '}({buckets[k].length})
          </button>
        ))}
      </nav>

      {tab === 'A' && <SectionA rows={buckets.A} sel={sel} setSel={setSel} onSubmit={submit} />}
      {tab === 'B' && <SectionBC rows={buckets.B} sel={sel} setSel={setSel} onSubmit={submit} multi />}
      {tab === 'C' && <SectionBC rows={buckets.C} sel={sel} setSel={setSel} onSubmit={submit} multi />}
      {tab === 'D' && <SectionD rows={buckets.D} />}
    </div>
  );
}

function SectionA({ rows, sel, setSel, onSubmit }: any) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const toConfirm = rows.filter((r: Row) => checked[r.md_id]);
  return (
    <div>
      <div className="mb-3 flex justify-between items-center">
        <label>
          <input type="checkbox"
            onChange={e => setChecked(Object.fromEntries(rows.map((r: Row) => [r.md_id, e.target.checked])))} />
          {' '}Seleccionar todos ({rows.length})
        </label>
        <button
          disabled={!toConfirm.length}
          onClick={() => onSubmit(toConfirm)}
          className="px-4 py-2 bg-[var(--ok)] text-[var(--accent-ink)] rounded disabled:opacity-50">
          Confirmar {toConfirm.length} seleccionadas
        </button>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-left border-b">
          <th></th><th>GTIN</th><th>Marca/Modelo</th><th>Proveedor</th>
          <th>Artículo</th><th>Duplicados</th>
        </tr></thead>
        <tbody>
          {rows.map((r: Row) => (
            <tr key={r.md_id} className="border-b hover:bg-[var(--bg)]">
              <td><input type="checkbox" checked={!!checked[r.md_id]}
                   onChange={e => setChecked(s => ({...s, [r.md_id]: e.target.checked}))} /></td>
              <td className="font-mono">{r.gtin}</td>
              <td>{r.marca_excel} / {r.modelo_excel}</td>
              <td>{r.proveedor}</td>
              <td className="font-mono text-xs">{r.candidatos?.[0]?.articulo_id}</td>
              <td>{r.gtin_dupes > 1 && <span className="px-2 py-1 bg-[var(--warn)]/10 rounded text-xs">×{r.gtin_dupes}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionBC({ rows, sel, setSel, onSubmit, multi }: any) {
  return (
    <div className="space-y-3">
      {rows.map((r: Row) => (
        <div key={r.md_id} className="p-3 border rounded">
          <div className="font-semibold">{r.marca_excel} / {r.modelo_excel}
            <span className="text-xs text-[var(--text-muted)] ml-2">({r.proveedor})</span></div>
          <div className="mt-2 space-y-1">
            {(r.candidatos || []).map((c: any) => (
              <label key={c.articulo_id} className="flex gap-2">
                <input type="radio" name={r.md_id}
                  checked={sel[r.md_id] === c.articulo_id}
                  onChange={() => setSel((s: any) => ({...s, [r.md_id]: c.articulo_id}))} />
                <span className="font-mono text-xs">{c.articulo_id}</span>
                <span className="flex-1">{c.nombre}</span>
                <span className="text-[var(--text-muted)]">score {c.score.toFixed(2)}</span>
              </label>
            ))}
          </div>
          <button
            disabled={!sel[r.md_id]}
            onClick={() => onSubmit([r])}
            className="mt-2 px-3 py-1 bg-[var(--ok)] text-[var(--accent-ink)] rounded disabled:opacity-50 text-sm">
            Confirmar
          </button>
        </div>
      ))}
      {multi && rows.length > 1 && (
        <button
          onClick={() => onSubmit(rows.filter((r: Row) => sel[r.md_id]))}
          className="px-4 py-2 bg-[var(--ok)] text-[var(--accent-ink)] rounded">
          Confirmar todas las seleccionadas
        </button>
      )}
    </div>
  );
}

function SectionD({ rows }: { rows: Row[] }) {
  return (
    <div>
      <p className="mb-3 text-[var(--text-muted)]">
        {rows.length} filas sin candidato — requieren acción manual (nuevo artículo o mapping manual).
      </p>
      <a href={`/api/matching/export?nivel=5&importacion_id=${rows[0]?.md_id?.split('-')[0] ?? ''}`}
         className="px-3 py-1 bg-[var(--surface)] text-[var(--accent-ink)] rounded">Exportar CSV</a>
    </div>
  );
}
