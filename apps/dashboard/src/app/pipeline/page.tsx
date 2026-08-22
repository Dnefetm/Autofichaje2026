"use client";

import { useState, useEffect, useCallback } from "react";
import { CheckCircle2, XCircle, RefreshCw, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Etapa = {
  orden: number;
  nombre: string;
  descripcion: string;
  count: () => Promise<number>;
  critica: boolean;
};

async function contar(tabla: string, filtro?: (q: any) => any): Promise<number> {
  let q = supabase.from(tabla).select("*", { count: "exact", head: true });
  if (filtro) q = filtro(q);
  const { count, error } = await q;
  if (error) return -1;
  return count ?? 0;
}

const ETAPAS: Etapa[] = [
  { orden: 1, nombre: "Listas crudas (raw)", descripcion: "listas_precios_raw", critica: false, count: () => contar("listas_precios_raw") },
  { orden: 2, nombre: "Precios proveedor actual", descripcion: "precios_proveedor_actual", critica: false, count: () => contar("precios_proveedor_actual") },
  { orden: 3, nombre: "Importaciones completadas", descripcion: "importaciones_excel (estado=completado)", critica: false, count: () => contar("importaciones_excel", (q) => q.eq("estado", "completado")) },
  { orden: 4, nombre: "Jobs de matching", descripcion: "matching_jobs", critica: false, count: () => contar("matching_jobs") },
  { orden: 5, nombre: "Decisiones de matching", descripcion: "matching_decisiones", critica: false, count: () => contar("matching_decisiones") },
  { orden: 6, nombre: "Costos pendientes (staging)", descripcion: "costos_pendientes", critica: false, count: () => contar("costos_pendientes") },
  { orden: 7, nombre: "Costos articulo (resueltos)", descripcion: "costos_articulo -> une por articulo_id", critica: true, count: () => contar("costos_articulo") },
  { orden: 8, nombre: "Listas vigentes", descripcion: "listas_precios_proveedor (vigente=true)", critica: true, count: () => contar("listas_precios_proveedor", (q) => q.eq("vigente", true)) },
  { orden: 9, nombre: "Precio vigente por SKU", descripcion: "v_precio_vigente_sku (vista)", critica: true, count: () => contar("v_precio_vigente_sku") },
  { orden: 10, nombre: "Precios publicados", descripcion: "precios_publicados", critica: false, count: () => contar("precios_publicados") },
];

export default function PipelinePage() {
  const [datos, setDatos] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [actualizado, setActualizado] = useState<string>("");

  const cargar = useCallback(async () => {
    setLoading(true);
    const res: Record<number, number> = {};
    for (const e of ETAPAS) {
      res[e.orden] = await e.count();
    }
    setDatos(res);
    setActualizado(new Date().toLocaleString("es-MX"));
    setLoading(false);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">Salud del Pipeline de Precios</h1>
        <button onClick={cargar} className="flex items-center gap-2 px-3 py-2 rounded bg-blue-600 text-[var(--accent-ink)] text-sm">
          <RefreshCw className={loading ? "w-4 h-4 animate-spin" : "w-4 h-4"} /> Actualizar
        </button>
      </div>
      <p className="text-sm text-[var(--text-muted)] mb-6">Flujo del proveedor al marketplace. Verde = con datos, rojo = vacio (revisar). Ultima lectura: {actualizado || "..."}</p>

      <div className="space-y-3">
        {ETAPAS.map((e) => {
          const n = datos[e.orden];
          const cargando = n === undefined;
          const vacio = n === 0;
          const error = n === -1;
          const color = error ? "border-yellow-400 bg-yellow-50" : vacio ? "border-red-400 bg-red-50" : "border-green-400 bg-green-50";
          return (
            <div key={e.orden} className={"flex items-center justify-between border rounded-lg p-4 " + (cargando ? "border-[var(--border)] bg-[var(--bg)]" : color)}>
              <div className="flex items-center gap-3">
                {cargando ? <RefreshCw className="w-5 h-5 text-[var(--text-faint)] animate-spin" /> : error ? <AlertTriangle className="w-5 h-5 text-yellow-500" /> : vacio ? <XCircle className="w-5 h-5 text-red-500" /> : <CheckCircle2 className="w-5 h-5 text-green-600" />}
                <div>
                  <div className="font-semibold">{e.orden}. {e.nombre} {e.critica && <span className="text-xs text-red-600">(critica)</span>}</div>
                  <div className="text-xs text-[var(--text-muted)]">{e.descripcion}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold">{cargando ? "..." : error ? "error" : n.toLocaleString("es-MX")}</div>
                <div className="text-xs text-[var(--text-muted)]">filas</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
