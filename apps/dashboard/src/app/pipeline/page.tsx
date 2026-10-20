"use client";

import { useState, useEffect, useCallback } from "react";
import { CheckCircle2, XCircle, RefreshCw, AlertTriangle } from "lucide-react";

type Etapa = {
  orden: number;
  nombre: string;
  descripcion: string;
  critica: boolean;
  n: number;
};

export default function PipelinePage() {
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  const [loading, setLoading] = useState(true);
  const [actualizado, setActualizado] = useState<string>("");

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/pipeline/salud');
      const j = await res.json();
      setEtapas(Array.isArray(j.etapas) ? j.etapas : []);
      setActualizado(new Date().toLocaleString("es-MX"));
    } catch {
      setEtapas([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">Salud del Pipeline de Precios</h1>
        <button onClick={cargar} className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--info)] text-[var(--accent-ink)] text-sm">
          <RefreshCw className={loading ? "w-4 h-4 animate-spin" : "w-4 h-4"} /> Actualizar
        </button>
      </div>
      <p className="text-sm text-[var(--text-muted)] mb-6">Flujo del proveedor al marketplace. Verde = con datos, rojo = vacio (revisar). Ultima lectura: {actualizado || "..."}</p>

      <div className="space-y-3">
        {etapas.map((e) => {
          const n = e.n;
          const vacio = n === 0;
          const error = n === -1;
          const color = error ? "border-[var(--warn)] bg-[var(--warn)]/10" : vacio ? "border-[var(--err)] bg-[var(--err)]/10" : "border-[var(--ok)] bg-[var(--ok)]/10";
          return (
            <div key={e.orden} className={`flex items-center justify-between border rounded-lg p-4 ${color}`}>
              <div className="flex items-center gap-3">
                {error ? <AlertTriangle className="w-5 h-5 text-[var(--warn)]" /> : vacio ? <XCircle className="w-5 h-5 text-[var(--err)]" /> : <CheckCircle2 className="w-5 h-5 text-[var(--ok)]" />}
                <div>
                  <div className="font-semibold">{e.orden}. {e.nombre} {e.critica && <span className="text-xs text-[var(--err)]">(critica)</span>}</div>
                  <div className="text-xs text-[var(--text-muted)]">{e.descripcion}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold">{error ? "error" : n.toLocaleString("es-MX")}</div>
                <div className="text-xs text-[var(--text-muted)]">filas</div>
              </div>
            </div>
          );
        })}
        {!loading && etapas.length === 0 && (
          <p className="text-sm text-[var(--warn)]">No se pudieron cargar los conteos.</p>
        )}
      </div>
    </div>
  );
}
