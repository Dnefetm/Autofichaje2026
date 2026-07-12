"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Save, Plus, Trash2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Nodo = { id: string; etiqueta: string; descripcion: string | null; dominio: string | null; pos_x: number; pos_y: number };
type Conexion = { id: string; origen: string; destino: string; etiqueta: string | null; conectado: boolean };

const W = 200;
const H = 90;

export default function MapaPage() {
  const [nodos, setNodos] = useState<Nodo[]>([]);
  const [conexiones, setConexiones] = useState<Conexion[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const arrastrando = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const n = await supabase.from("mapa_nodos").select("*");
    const c = await supabase.from("mapa_conexiones").select("*");
    setNodos((n.data as Nodo[]) || []);
    setConexiones((c.data as Conexion[]) || []);
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  function onMouseDown(e: React.MouseEvent, nodo: Nodo) {
    setSel(nodo.id);
    arrastrando.current = { id: nodo.id, dx: e.clientX - nodo.pos_x, dy: e.clientY - nodo.pos_y };
  }

  function onMouseMove(e: React.MouseEvent) {
    const a = arrastrando.current;
    if (!a) return;
    setNodos((prev) => prev.map((n) => n.id === a.id ? { ...n, pos_x: e.clientX - a.dx, pos_y: e.clientY - a.dy } : n));
  }

  function onMouseUp() { arrastrando.current = null; }

  async function guardar() {
    setGuardando(true);
    for (const n of nodos) {
      await supabase.from("mapa_nodos").update({ pos_x: Math.round(n.pos_x), pos_y: Math.round(n.pos_y), etiqueta: n.etiqueta, descripcion: n.descripcion }).eq("id", n.id);
    }
    setGuardando(false);
    setMensaje("Guardado " + new Date().toLocaleTimeString("es-MX"));
    setTimeout(() => setMensaje(""), 3000);
  }

  async function agregarNodo() {
    const id = "nodo_" + Date.now();
    const nuevo: Nodo = { id, etiqueta: "Nuevo proceso", descripcion: "Describe este proceso", dominio: "Otro", pos_x: 400, pos_y: 300 };
    await supabase.from("mapa_nodos").insert(nuevo);
    setNodos((p) => [...p, nuevo]);
    setSel(id);
  }

  async function borrarNodo(id: string) {
    await supabase.from("mapa_nodos").delete().eq("id", id);
    setNodos((p) => p.filter((n) => n.id !== id));
    setConexiones((p) => p.filter((c) => c.origen !== id && c.destino !== id));
    setSel(null);
  }

  function actualizarSel(campo: "etiqueta" | "descripcion", valor: string) {
    setNodos((p) => p.map((n) => n.id === sel ? { ...n, [campo]: valor } : n));
  }

  const nodoSel = nodos.find((n) => n.id === sel) || null;

  return (
    <div className="flex h-screen">
      <div className="flex-1 relative overflow-auto bg-gray-50" onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-white border-b px-4 py-2">
          <h1 className="font-bold text-lg mr-auto">Mapa de Procesos del Negocio</h1>
          <button onClick={cargar} className="flex items-center gap-1 text-sm px-2 py-1 border rounded"><RefreshCw className={cargando ? "w-4 h-4 animate-spin" : "w-4 h-4"} /> Recargar</button>
          <button onClick={agregarNodo} className="flex items-center gap-1 text-sm px-2 py-1 border rounded"><Plus className="w-4 h-4" /> Proceso</button>
          <button onClick={guardar} className="flex items-center gap-1 text-sm px-3 py-1 rounded bg-blue-600 text-white"><Save className="w-4 h-4" /> {guardando ? "Guardando..." : "Guardar"}</button>
          {mensaje && <span className="text-xs text-green-600">{mensaje}</span>}
        </div>
        <div className="relative" style={{ width: 1400, height: 800 }}>
          <svg className="absolute inset-0 pointer-events-none" width={1400} height={800}>
            <defs>
              <marker id="flecha" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#64748b" /></marker>
              <marker id="flechaRoja" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#dc2626" /></marker>
            </defs>
            {conexiones.map((c) => {
              const o = nodos.find((n) => n.id === c.origen);
              const d = nodos.find((n) => n.id === c.destino);
              if (!o || !d) return null;
              const x1 = o.pos_x + W / 2, y1 = o.pos_y + H / 2, x2 = d.pos_x + W / 2, y2 = d.pos_y + H / 2;
              const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
              return (
                <g key={c.id}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c.conectado ? "#64748b" : "#dc2626"} strokeWidth={2} strokeDasharray={c.conectado ? "0" : "6 4"} markerEnd={c.conectado ? "url(#flecha)" : "url(#flechaRoja)"} />
                  {c.etiqueta && <text x={mx} y={my - 4} fontSize={10} fill={c.conectado ? "#475569" : "#dc2626"} textAnchor="middle">{c.etiqueta}</text>}
                </g>
              );
            })}
          </svg>
          {nodos.map((n) => (
            <div key={n.id} onMouseDown={(e) => onMouseDown(e, n)} className={"absolute rounded-lg border-2 bg-white shadow-sm p-2 cursor-move select-none " + (sel === n.id ? "border-blue-500" : "border-gray-300")} style={{ left: n.pos_x, top: n.pos_y, width: W, height: H }}>
              <div className="text-xs text-gray-400">{n.dominio}</div>
              <div className="font-semibold text-sm">{n.etiqueta}</div>
              <div className="text-[10px] text-gray-500 leading-tight overflow-hidden" style={{ maxHeight: 34 }}>{n.descripcion}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="w-72 border-l bg-white p-4 overflow-auto">
        <h2 className="font-bold mb-2">Editar proceso</h2>
        {nodoSel ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500">Nombre</label>
              <input className="w-full border rounded px-2 py-1 text-sm" value={nodoSel.etiqueta} onChange={(e) => actualizarSel("etiqueta", e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500">Descripcion</label>
              <textarea className="w-full border rounded px-2 py-1 text-sm" rows={5} value={nodoSel.descripcion || ""} onChange={(e) => actualizarSel("descripcion", e.target.value)} />
            </div>
            <button onClick={() => borrarNodo(nodoSel.id)} className="flex items-center gap-1 text-sm text-red-600"><Trash2 className="w-4 h-4" /> Borrar proceso</button>
            <p className="text-xs text-gray-400">Recuerda pulsar Guardar para persistir los cambios y las posiciones.</p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Haz clic en un proceso para ver y editar su descripcion. Arrastra las cajas para reacomodar el mapa. Las flechas rojas punteadas indican una conexion rota.</p>
        )}
      </div>
    </div>
  );
}
