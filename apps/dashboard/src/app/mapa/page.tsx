'use client';
import { useEffect, useState } from 'react';
type Arista = { origen: string; col: string; destino: string; estado: string; filas_origen: number | null; filas_destino: number | null };
type Huerfana = { tabla: string; filas: number | null };
type Data = { ok: boolean; generado: string; conteos: Record<string, number | null>; aristas: Arista[]; huerfanas: Huerfana[]; resumen: { tablas: number; aristas: number; rotas: number; sin_uso: number } };
const POS: Record<string, { x: number; y: number; label: string }> = {
importaciones_excel: { x: 40, y: 40, label: 'Importaciones Excel' },
listas_precios_raw: { x: 40, y: 130, label: 'Listas precios (raw)' },
listas_precios_raw_staging: { x: 40, y: 220, label: 'Staging' },
listas_precios_proveedor: { x: 40, y: 310, label: 'Listas proveedor' },
precios_proveedor_actual: { x: 300, y: 130, label: 'Precio vigente prov.' },
matching_jobs: { x: 300, y: 250, label: 'Matching jobs' },
proveedor_articulos_alias: { x: 300, y: 340, label: 'Alias prov->art' },
costos_articulo: { x: 560, y: 130, label: 'Costos por articulo' },
costos_pendientes: { x: 560, y: 220, label: 'Costos pendientes' },
articulos: { x: 820, y: 260, label: 'ARTICULOS (centro)' },
reglas_precio: { x: 560, y: 340, label: 'Reglas de precio' },
pricing_rule_v3: { x: 560, y: 430, label: 'Pricing rules v3' },
marketplace_configs: { x: 560, y: 520, label: 'Marketplace configs' },
precios_publicacion: { x: 820, y: 430, label: 'Precios publicacion' },
precios_publicados: { x: 820, y: 520, label: 'Precios publicados' },
marketplace_prices: { x: 1080, y: 430, label: 'Marketplace prices' },
publicaciones_externas: { x: 1080, y: 260, label: 'Publicaciones ext.' },
mapeo_publicacion_articulo: { x: 1080, y: 350, label: 'Mapeo pub<->art' },
fichas_tecnicas: { x: 820, y: 40, label: 'Fichas tecnicas' },
ficha_extracciones: { x: 1080, y: 40, label: 'Extracciones' },
ficha_pdfs: { x: 1080, y: 120, label: 'PDFs' },
ficha_imagenes: { x: 1300, y: 40, label: 'Imagenes' },
fuentes_documento: { x: 1300, y: 120, label: 'Fuentes doc.' },
marcas: { x: 820, y: 130, label: 'Marcas' },
fabricantes: { x: 820, y: 210, label: 'Fabricantes' },
ordenes: { x: 1300, y: 260, label: 'Ordenes' },
orden_items: { x: 1300, y: 350, label: 'Orden items' },
inventory_snapshot: { x: 1300, y: 440, label: 'Inventario' },
reservaciones_stock: { x: 1300, y: 530, label: 'Reservas stock' },
egresos: { x: 1300, y: 620, label: 'Egresos' },
ingresos: { x: 1300, y: 700, label: 'Ingresos' },
operadores: { x: 1080, y: 620, label: 'Operadores' },
sync_logs: { x: 560, y: 610, label: 'Sync logs' },
jobs: { x: 300, y: 610, label: 'Jobs' },
historial_cambios_precio: { x: 1080, y: 520, label: 'Historial precio' }
};
const COLOR: Record<string, string> = { viva: '#16a34a', rota: '#dc2626', sin_uso: '#9ca3af' };
const NW = 150, NH = 46;
function fmt(n: number | null) { return n == null ? 's/d' : n.toLocaleString('es-MX'); }
export default function MapaConexiones() {
const [data, setData] = useState<Data | null>(null);
const [sel, setSel] = useState<Arista | null>(null);
const [cargando, setCargando] = useState(false);
async function cargar() {
setCargando(true);
try { const r = await fetch('/api/mapa/salud', { cache: 'no-store' }); setData(await r.json()); } catch {} 
setCargando(false);
}
useEffect(() => { cargar(); }, []);
const aristas = data?.aristas ?? [];
const nodos = Object.keys(POS);
return (
<div style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>
<div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
<h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Mapa de conexiones (FKs reales, en vivo)</h1>
<button onClick={cargar} style={{ padding: '6px 14px', background: '#2563eb', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer' }}>{cargando ? 'Cargando...' : 'Recargar'}</button>
{data && <span style={{ fontSize: 12, color: '#475569' }}>Actualizado: {new Date(data.generado).toLocaleString('es-MX')}</span>}
</div>
{data?.resumen && <div style={{ fontSize: 13, marginBottom: 10 }}>Tablas: <b>{data.resumen.tablas}</b> | Conexiones FK: <b>{data.resumen.aristas}</b> | <span style={{ color: '#dc2626' }}>Rotas (destino vacio): <b>{data.resumen.rotas}</b></span> | <span style={{ color: '#9ca3af' }}>Sin uso (origen vacio): <b>{data.resumen.sin_uso}</b></span></div>}
<div style={{ display: 'flex', gap: 16, fontSize: 12, marginBottom: 12 }}>
<span style={{ color: '#16a34a' }}>&#9473; Conexion viva</span>
<span style={{ color: '#dc2626' }}>&#9473; Conexion rota (tabla destino vacia)</span>
<span style={{ color: '#9ca3af' }}>&#9473; Sin uso (origen vacio)</span>
</div>
<div style={{ overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fafafa' }}>
<svg width={1480} height={780} style={{ display: 'block' }}>
{aristas.map((a, i) => {
const o = POS[a.origen]; const d = POS[a.destino];
if (!o || !d) return null;
const x1 = o.x + NW / 2, y1 = o.y + NH / 2, x2 = d.x + NW / 2, y2 = d.y + NH / 2;
const c = COLOR[a.estado] || '#94a3b8';
return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={a.estado === 'viva' ? 1.5 : 2} strokeDasharray={a.estado === 'viva' ? '0' : '5,4'} opacity={0.75} style={{ cursor: 'pointer' }} onClick={() => setSel(a)} />;
})}
{nodos.map((n) => {
const p = POS[n]; const cnt = data?.conteos?.[n];
const vacio = cnt === 0;
return (
<g key={n} onClick={() => setSel({ origen: n, col: '', destino: '', estado: vacio ? 'sin_uso' : 'viva', filas_origen: cnt ?? null, filas_destino: null })} style={{ cursor: 'pointer' }}>
<rect x={p.x} y={p.y} width={NW} height={NH} rx={8} fill={vacio ? '#fef2f2' : '#fff'} stroke={vacio ? '#dc2626' : '#334155'} strokeWidth={1.5} />
<text x={p.x + 8} y={p.y + 18} fontSize={11} fontWeight={700} fill='#0f172a'>{p.label}</text>
<text x={p.x + 8} y={p.y + 34} fontSize={10} fill={vacio ? '#dc2626' : '#16a34a'}>{n}: {fmt(cnt ?? null)}</text>
</g>
);
})}
</svg>
</div>
{sel && (
<div style={{ marginTop: 12, padding: 12, border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', fontSize: 13 }}>
{sel.col ? (
<div><b>Conexion:</b> {sel.origen}.{sel.col} &rarr; {sel.destino} &nbsp; <span style={{ color: COLOR[sel.estado] }}>[{sel.estado.toUpperCase()}]</span><br/>Filas origen ({sel.origen}): <b>{fmt(sel.filas_origen)}</b> | Filas destino ({sel.destino}): <b>{fmt(sel.filas_destino)}</b>{sel.estado === 'rota' && <div style={{ color: '#dc2626', marginTop: 4 }}>La tabla destino esta vacia: esta relacion no puede resolverse. Cadena rota aqui.</div>}</div>
) : (
<div><b>Tabla:</b> {sel.origen} &mdash; Filas: <b>{fmt(sel.filas_origen)}</b></div>
)}
</div>
)}
<h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 24 }}>Tablas SIN conexion (huerfanas: sin FK entrante ni saliente)</h2>
<p style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Estas tablas no tienen ninguna clave foranea declarada. Las de negocio (matching_decisiones, meli_webhook_events, webhook_buffer) se enlazan solo por convencion, no por FK: riesgo de integridad.</p>
<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
{(data?.huerfanas ?? []).map((h) => (
<div key={h.tabla} style={{ border: '1px dashed #f59e0b', background: '#fffbeb', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>
<b>{h.tabla}</b> <span style={{ color: '#92400e' }}>({fmt(h.filas)} filas)</span>
</div>
))}
</div>
</div>
);
}
