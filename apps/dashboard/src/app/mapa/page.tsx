'use client';
import { useEffect, useState } from 'react';
type Arista = { origen: string; col: string; destino: string; estado: string; filas_origen: number | null; filas_destino: number | null };
type Huerfana = { tabla: string; filas: number | null };
type Dicc = { clave: string; tipo: string; nombre: string; etapa: string | null; descripcion: string | null; proposito: string | null; entradas: string | null; salidas: string | null; responsable: string | null; orden: number | null };
type Data = { ok: boolean; generado: string; conteos: Record<string, number | null>; aristas: Arista[]; huerfanas: Huerfana[]; diccionario: Dicc[]; resumen: { tablas: number; aristas: number; rotas: number; sin_uso: number } };
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
const CAMPOS: { k: keyof Dicc; label: string; area?: boolean }[] = [{ k: 'nombre', label: 'Nombre' }, { k: 'etapa', label: 'Etapa' }, { k: 'descripcion', label: 'Descripcion', area: true }, { k: 'proposito', label: 'Proposito', area: true }, { k: 'entradas', label: 'Entradas' }, { k: 'salidas', label: 'Salidas' }, { k: 'responsable', label: 'Responsable' }, { k: 'orden', label: 'Orden' }];
export default function MapaProcesos() {
const [data, setData] = useState<Data | null>(null);
const [sel, setSel] = useState<Arista | null>(null);
const [cargando, setCargando] = useState(false);
const [vista, setVista] = useState<'director' | 'catalogo' | 'tecnico'>('director');
const [busca, setBusca] = useState('');
const [edit, setEdit] = useState<Dicc | null>(null);
const [guardando, setGuardando] = useState(false);
const [aviso, setAviso] = useState('');
async function cargar() { setCargando(true); try { const r = await fetch('/api/mapa/salud', { cache: 'no-store' }); setData(await r.json()); } catch {} setCargando(false); }
useEffect(() => { cargar(); }, []);
async function guardar() { if (!edit) return; setGuardando(true); setAviso(''); try { const r = await fetch('/api/mapa/salud', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clave: edit.clave, nombre: edit.nombre, etapa: edit.etapa, descripcion: edit.descripcion, proposito: edit.proposito, entradas: edit.entradas, salidas: edit.salidas, responsable: edit.responsable, orden: edit.orden == null ? null : Number(edit.orden) }) }); const j = await r.json(); if (!j.ok) { setAviso('Error: ' + (j.error || 'no se pudo guardar')); setGuardando(false); return; } setEdit(null); await cargar(); setAviso('Cambios guardados. Las tres vistas se actualizaron.'); setTimeout(() => setAviso(''), 4000); } catch (e) { setAviso('Error de red al guardar'); } setGuardando(false); }
const aristas = data?.aristas ?? [];
const nodos = Object.keys(POS);
const dicc = data?.diccionario ?? [];
const procesos = dicc.filter((d) => d.tipo === 'proceso').sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99));
const tablasDicc = dicc.filter((d) => d.tipo === 'tabla');
const descPorClave: Record<string, Dicc> = {};
for (const d of dicc) descPorClave[d.clave] = d;
const filtroTxt = busca.trim().toLowerCase();
const tablasFiltradas = tablasDicc.filter((d) => !filtroTxt || d.clave.toLowerCase().includes(filtroTxt) || (d.nombre || '').toLowerCase().includes(filtroTxt) || (d.descripcion || '').toLowerCase().includes(filtroTxt) || (d.etapa || '').toLowerCase().includes(filtroTxt)).sort((a, b) => (a.etapa || '').localeCompare(b.etapa || '') || a.clave.localeCompare(b.clave));
const etapas = Array.from(new Set(tablasFiltradas.map((d) => d.etapa || 'Sin etapa')));
const rotas = data?.resumen?.rotas ?? 0;
const sinUso = data?.resumen?.sin_uso ?? 0;
const huerfanasNeg = (data?.huerfanas ?? []).filter((h) => (h.filas ?? 0) > 0);
const tab = (id: 'director' | 'catalogo' | 'tecnico', txt: string) => (<button onClick={() => setVista(id)} style={{ padding: '8px 16px', border: 0, borderBottom: vista === id ? '3px solid #2563eb' : '3px solid transparent', background: 'transparent', color: vista === id ? '#2563eb' : '#475569', fontWeight: vista === id ? 700 : 500, cursor: 'pointer', fontSize: 14 }}>{txt}</button>);
const btnEdit = (d: Dicc) => (<button onClick={() => { setEdit({ ...d }); setAviso(''); }} style={{ fontSize: 11, padding: '3px 8px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', color: '#2563eb' }}>Editar</button>);
return (<div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 1500, margin: '0 auto' }}>
<div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}><h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Mapa de procesos - Autofichaje2026</h1><button onClick={cargar} style={{ padding: '6px 14px', background: '#2563eb', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer' }}>{cargando ? 'Cargando...' : 'Recargar'}</button>{data && <span style={{ fontSize: 12, color: '#64748b' }}>Actualizado: {new Date(data.generado).toLocaleString('es-MX')}</span>}</div>
{aviso && <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, fontSize: 13, background: aviso.startsWith('Error') ? '#fef2f2' : '#f0fdf4', color: aviso.startsWith('Error') ? '#dc2626' : '#16a34a', border: '1px solid ' + (aviso.startsWith('Error') ? '#fecaca' : '#bbf7d0') }}>{aviso}</div>}
<div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e2e8f0', marginBottom: 16 }}>{tab('director', 'Vista Director')}{tab('catalogo', 'Catalogo de procesos')}{tab('tecnico', 'Mapa tecnico (FKs)')}</div>
{vista === 'director' && (<div>
<div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}><div style={{ flex: 1, minWidth: 150, border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, background: '#f8fafc' }}><div style={{ fontSize: 12, color: '#64748b' }}>Tablas mapeadas</div><div style={{ fontSize: 28, fontWeight: 800 }}>{data?.resumen?.tablas ?? '-'}</div></div><div style={{ flex: 1, minWidth: 150, border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, background: '#f8fafc' }}><div style={{ fontSize: 12, color: '#64748b' }}>Conexiones FK</div><div style={{ fontSize: 28, fontWeight: 800 }}>{data?.resumen?.aristas ?? '-'}</div></div><div style={{ flex: 1, minWidth: 150, border: '1px solid ' + (rotas > 0 ? '#dc2626' : '#16a34a'), borderRadius: 8, padding: 14, background: rotas > 0 ? '#fef2f2' : '#f0fdf4' }}><div style={{ fontSize: 12, color: '#64748b' }}>Cadenas rotas</div><div style={{ fontSize: 28, fontWeight: 800, color: rotas > 0 ? '#dc2626' : '#16a34a' }}>{rotas}</div></div><div style={{ flex: 1, minWidth: 150, border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, background: '#f8fafc' }}><div style={{ fontSize: 12, color: '#64748b' }}>Relaciones sin uso</div><div style={{ fontSize: 28, fontWeight: 800 }}>{sinUso}</div></div></div>
<h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Como funciona el sistema, paso a paso</h2>
<p style={{ fontSize: 13, color: '#64748b', marginTop: 0 }}>Cada tarjeta describe un macro-proceso del pipeline. Pulsa Editar para cambiar el texto: se guarda en mapa_diccionario y se refleja en las tres vistas.</p>
{procesos.length === 0 && <p style={{ fontSize: 13, color: '#94a3b8' }}>Cargando descripciones del diccionario...</p>}
<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>{procesos.map((p) => (<div key={p.clave} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 14 }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: 12, color: '#2563eb', fontWeight: 700 }}>{p.clave}</span>{btnEdit(p)}</div><div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{p.nombre}</div><div style={{ fontSize: 13, color: '#334155' }}>{p.descripcion}</div>{p.proposito && <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}><b>Proposito:</b> {p.proposito}</div>}{p.entradas && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}><b>Entradas:</b> {p.entradas}</div>}{p.salidas && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}><b>Salidas:</b> {p.salidas}</div>}{p.responsable && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}><b>Responsable:</b> {p.responsable}</div>}</div>))}</div>
{huerfanasNeg.length > 0 && (<div style={{ marginTop: 20, border: '1px solid #f59e0b', background: '#fffbeb', borderRadius: 8, padding: 14 }}><b>Atencion:</b> Hay {huerfanasNeg.length} tablas con datos que no tienen relacion (FK) declarada: {huerfanasNeg.map((h) => h.tabla).join(', ')}.</div>)}
</div>)}
{vista === 'catalogo' && (<div>
<div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder='Buscar tabla, proceso o etapa...' style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, minWidth: 280 }} /><span style={{ fontSize: 12, color: '#64748b' }}>{tablasFiltradas.length} de {tablasDicc.length} tablas</span></div>
{etapas.map((et) => (<div key={et} style={{ marginBottom: 18 }}><h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', borderBottom: '2px solid #e2e8f0', paddingBottom: 4, marginBottom: 8 }}>{et}</h3><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10 }}>{tablasFiltradas.filter((d) => (d.etapa || 'Sin etapa') === et).map((d) => { const cnt = data?.conteos?.[d.clave]; return (<div key={d.clave} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}><b style={{ fontSize: 14 }}>{d.nombre}</b><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{cnt != null && <span style={{ fontSize: 11, color: '#64748b' }}>{fmt(cnt)} filas</span>}{btnEdit(d)}</span></div><code style={{ fontSize: 11, color: '#7c3aed' }}>{d.clave}</code><div style={{ fontSize: 12, color: '#334155', marginTop: 6 }}>{d.descripcion}</div>{d.proposito && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}><b>Proposito:</b> {d.proposito}</div>}<div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{d.responsable ? 'Responsable: ' + d.responsable : ''}</div></div>); })}</div></div>))}
{tablasFiltradas.length === 0 && <p style={{ fontSize: 13, color: '#94a3b8' }}>Sin resultados para tu busqueda.</p>}
</div>)}
{vista === 'tecnico' && (<div><div style={{ marginBottom: 12, fontSize: 13, color: '#475569' }}>{data?.resumen && <span>Tablas: <b>{data.resumen.tablas}</b> | Conexiones FK: <b>{data.resumen.aristas}</b> | <span style={{ color: '#dc2626' }}>Rotas (destino vacio): <b>{data.resumen.rotas}</b></span> | <span style={{ color: '#9ca3af' }}>Sin uso (origen vacio): <b>{data.resumen.sin_uso}</b></span></span>}</div><div style={{ display: 'flex', gap: 16, fontSize: 12, marginBottom: 8 }}><span style={{ color: '#16a34a' }}>&#9632; Conexion viva</span><span style={{ color: '#dc2626' }}>&#9632; Conexion rota (tabla destino vacia)</span><span style={{ color: '#9ca3af' }}>&#9632; Sin uso (origen vacio)</span></div><div style={{ overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}><svg width={1470} height={780} style={{ background: '#fafafa', minWidth: 1470 }}>{aristas.map((a, i) => { const o = POS[a.origen]; const d = POS[a.destino]; if (!o || !d) return null; const x1 = o.x + NW / 2, y1 = o.y + NH / 2, x2 = d.x + NW / 2, y2 = d.y + NH / 2; const c = COLOR[a.estado] || '#94a3b8'; return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={1.5} opacity={0.6} style={{ cursor: 'pointer' }} onClick={() => setSel(a)} />; })}{nodos.map((n) => { const p = POS[n]; const cnt = data?.conteos?.[n]; const vacio = cnt === 0; return (<g key={n} onClick={() => setSel({ origen: n, col: '', destino: '', estado: vacio ? 'sin_uso' : 'viva', filas_origen: cnt ?? null, filas_destino: null })} style={{ cursor: 'pointer' }}><rect x={p.x} y={p.y} width={NW} height={NH} rx={6} fill={vacio ? '#f1f5f9' : '#fff'} stroke={vacio ? '#cbd5e1' : '#2563eb'} strokeWidth={1.5} /><text x={p.x + NW / 2} y={p.y + 19} textAnchor='middle' fontSize={11} fontWeight={700} fill='#0f172a'>{p.label}</text><text x={p.x + NW / 2} y={p.y + 35} textAnchor='middle' fontSize={9} fill='#64748b'>{n}: {fmt(cnt ?? null)}</text></g>); })}</svg></div>{sel && (<div style={{ marginTop: 12, padding: 14, border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc', fontSize: 13 }}>{sel.col ? (<div><div><b>Conexion:</b> {sel.origen}.{sel.col} {'->'} {sel.destino} [{sel.estado.toUpperCase()}]</div><div style={{ marginTop: 4 }}>Filas origen ({sel.origen}): <b>{fmt(sel.filas_origen)}</b> | Filas destino ({sel.destino}): <b>{fmt(sel.filas_destino)}</b></div>{sel.estado === 'rota' && <div style={{ marginTop: 4, color: '#dc2626' }}>La tabla destino esta vacia: esta relacion no puede resolverse. Cadena rota aqui.</div>}{descPorClave[sel.origen]?.descripcion && <div style={{ marginTop: 6, color: '#475569' }}><b>{sel.origen}:</b> {descPorClave[sel.origen]?.descripcion}</div>}</div>) : (<div><div><b>Tabla:</b> {sel.origen} - Filas: <b>{fmt(sel.filas_origen)}</b></div>{descPorClave[sel.origen]?.descripcion && <div style={{ marginTop: 6, color: '#475569' }}>{descPorClave[sel.origen]?.descripcion}</div>}</div>)}</div>)}<h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 24, marginBottom: 4 }}>Tablas SIN conexion (huerfanas: sin FK entrante ni saliente)</h2><p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>Estas tablas no tienen ninguna clave foranea declarada.</p><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{(data?.huerfanas ?? []).map((h) => (<span key={h.tabla} style={{ fontSize: 12, padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff' }}><b>{h.tabla}</b> ({fmt(h.filas)} filas)</span>))}</div></div>)}{edit && (<div onClick={() => setEdit(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}><div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, padding: 20, width: 520, maxWidth: '100%', maxHeight: '90vh', overflow: 'auto' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}><h3 style={{ margin: 0, fontSize: 16 }}>Editar: {edit.clave}</h3><button onClick={() => setEdit(null)} style={{ border: 0, background: 'transparent', fontSize: 20, cursor: 'pointer', color: '#64748b' }}>&times;</button></div>{CAMPOS.map((c) => (<div key={c.k} style={{ marginBottom: 10 }}><label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 3 }}>{c.label}</label>{c.area ? (<textarea value={(edit[c.k] as string) ?? ''} onChange={(e) => setEdit({ ...edit, [c.k]: e.target.value })} rows={3} style={{ width: '100%', padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }} />) : (<input value={(edit[c.k] as string | number) ?? ''} onChange={(e) => setEdit({ ...edit, [c.k]: e.target.value })} style={{ width: '100%', padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />)}</div>))}<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}><button onClick={() => setEdit(null)} disabled={guardando} style={{ padding: '8px 14px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Cancelar</button><button onClick={guardar} disabled={guardando} style={{ padding: '8px 14px', border: 0, borderRadius: 6, background: '#2563eb', color: '#fff', cursor: 'pointer' }}>{guardando ? 'Guardando...' : 'Guardar'}</button></div></div></div>)}</div>);
}
