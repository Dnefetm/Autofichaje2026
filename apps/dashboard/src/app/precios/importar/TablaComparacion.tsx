"use client";

import { useMemo, useState } from "react";

type FilaExcel = {
  indice: number;
  codigo?: string | null;
  descripcion?: string | null;
  marca?: string | null;
  precio?: number | null;
  [k: string]: any;
};

type Candidato = {
  articulo_id: string;
  codigo: string;
  descripcion: string;
  marca?: string | null;
  score: number;
};

type FilaMapeada = {
  fila: FilaExcel;
  candidatos: Candidato[];
  seleccionado?: string | null;
  estado: "match" | "duda" | "sin_match";
};

type Props = {
  filas: FilaMapeada[];
  onSeleccionar: (indice: number, articuloId: string | null) => void;
};

export default function TablaComparacion({ filas, onSeleccionar }: Props) {
  const [filtro, setFiltro] = useState<"todos" | "match" | "duda" | "sin_match">("duda");
  const [busqueda, setBusqueda] = useState("");

  const filasFiltradas = useMemo(() => {
    return filas.filter((f) => {
      if (filtro !== "todos" && f.estado !== filtro) return false;
      if (busqueda) {
        const q = busqueda.toLowerCase();
        const hay =
          (f.fila.codigo || "").toLowerCase().includes(q) ||
          (f.fila.descripcion || "").toLowerCase().includes(q) ||
          (f.fila.marca || "").toLowerCase().includes(q);
        if (!hay) return false;
      }
      return true;
    });
  }, [filas, filtro, busqueda]);

  const stats = useMemo(() => {
    const s = { match: 0, duda: 0, sin_match: 0 };
    for (const f of filas) s[f.estado]++;
    return s;
  }, [filas]);

  return (
    <div className="w-full">
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <button
          onClick={() => setFiltro("todos")}
          className={`px-3 py-1 rounded text-sm ${filtro === "todos" ? "bg-blue-600 text-white" : "bg-gray-200"}`}
        >
          Todos ({filas.length})
        </button>
        <button
          onClick={() => setFiltro("match")}
          className={`px-3 py-1 rounded text-sm ${filtro === "match" ? "bg-green-600 text-white" : "bg-gray-200"}`}
        >
          Match 100% ({stats.match})
        </button>
        <button
          onClick={() => setFiltro("duda")}
          className={`px-3 py-1 rounded text-sm ${filtro === "duda" ? "bg-yellow-600 text-white" : "bg-gray-200"}`}
        >
          Dudas ({stats.duda})
        </button>
        <button
          onClick={() => setFiltro("sin_match")}
          className={`px-3 py-1 rounded text-sm ${filtro === "sin_match" ? "bg-red-600 text-white" : "bg-gray-200"}`}
        >
          Sin match ({stats.sin_match})
        </button>
        <input
          type="text"
          placeholder="Buscar cdigo, descripcin, marca..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="ml-auto px-3 py-1 border rounded text-sm min-w-[260px]"
        />
      </div>

      <div className="overflow-x-auto border rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 sticky top-0">
            <tr>
              <th className="p-2 text-left border-r" colSpan={3}>EXCEL (lo que subiste)</th>
              <th className="p-2 text-center border-r">%</th>
              <th className="p-2 text-left" colSpan={4}>CATLOGO MAESTRO (candidato)</th>
            </tr>
            <tr className="bg-gray-50">
              <th className="p-2 text-left">Cdigo Excel</th>
              <th className="p-2 text-left">Descripcin Excel</th>
              <th className="p-2 text-left border-r">Marca Excel</th>
              <th className="p-2 text-center border-r">Score</th>
              <th className="p-2 text-left">Cdigo Maestro</th>
              <th className="p-2 text-left">Descripcin Maestro</th>
              <th className="p-2 text-left">Marca Maestro</th>
              <th className="p-2 text-left">Accin</th>
            </tr>
          </thead>
          <tbody>
            {filasFiltradas.map((f) => {
              const top = f.candidatos[0];
              const color =
                f.estado === "match" ? "bg-green-50" : f.estado === "duda" ? "bg-yellow-50" : "bg-red-50";
              return (
                <tr key={f.fila.indice} className={`border-t ${color}`}>
                  <td className="p-2 font-mono">{f.fila.codigo || ""}</td>
                  <td className="p-2">{f.fila.descripcion || ""}</td>
                  <td className="p-2 border-r">{f.fila.marca || ""}</td>
                  <td className="p-2 text-center border-r font-bold">
                    {top ? `${Math.round(top.score * 100)}%` : "-"}
                  </td>
                  <td className="p-2 font-mono">{top?.codigo || "-"}</td>
                  <td className="p-2">{top?.descripcion || "Sin candidato"}</td>
                  <td className="p-2">{top?.marca || "-"}</td>
                  <td className="p-2">
                    <select
                      value={f.seleccionado || ""}
                      onChange={(e) => onSeleccionar(f.fila.indice, e.target.value || null)}
                      className="border rounded px-2 py-1 text-xs max-w-[220px]"
                    >
                      <option value="">-- Sin asignar --</option>
                      {f.candidatos.map((c) => (
                        <option key={c.articulo_id} value={c.articulo_id}>
                          {Math.round(c.score * 100)}% | {c.codigo} | {c.descripcion.slice(0, 40)}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filasFiltradas.length === 0 && (
        <div className="text-center py-6 text-gray-500">No hay filas con el filtro actual.</div>
      )}
    </div>
  );
}
