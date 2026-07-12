'use client';
import { useEffect, useState } from 'react';

type Conteos = Record<string, number | null>;
type Nodo = { tabla?: string; label: string; desc: string; funcion: string; trigger?: string };
type Eslabon = { id: number; titulo: string; motor: string; nodos: Nodo[] };

const CADENA: Eslabon[] = [
 { id: 1, titulo: '1. Importacion de precios', motor: 'Manual (subir Excel)', nodos: [
 { tabla: 'importaciones_excel', label: 'Cargas Excel', desc: 'Cada archivo de lista de proveedor subido', funcion: 'POST /api/precios/importar', trigger: 'trg_disparar_worker_importacion, trg_validar_transicion_importacion' },
 { tabla: 'listas_precios_raw', label: 'Filas crudas', desc: 'Renglones sin procesar del Excel', funcion: '/precios/importar/[id]/iniciar-parser' },
 { tabla: 'listas_precios_raw_staging', label: 'Staging', desc: 'Area temporal de parseo', funcion: 'parser' },
 ]},
 { id: 2, titulo: '2. Precios vigentes', motor: 'Consolidacion', nodos: [
 { tabla: 'precios_proveedor_actual', label: 'Precio vigente proveedor', desc: 'Precio actual por codigo de proveedor', funcion: '/importaciones/[id]/consolidar-revision' },
 ]},
 { id: 3, titulo: '3. Matching codigo -> articulo', motor: 'CRON dispatch-matching', nodos: [
 { tabla: 'matching_decisiones', label: 'Decisiones', desc: 'Match propuesto codigo proveedor a articulo', funcion: '/api/cron/dispatch-matching' },
 { tabla: 'proveedor_articulos_alias', label: 'Alias', desc: 'Equivalencias confirmadas', funcion: 'trigger', trigger: 'tg_promote_pendientes' },
 { tabla: 'matching_jobs', label: 'Jobs', desc: 'Trabajos de matching', funcion: 'cron' },
 { tabla: 'matching_resultados', label: 'Resultados', desc: 'Resultado formal del match', funcion: 'cron' },
 ]},
 { id: 4, titulo: '4. Costos por articulo', motor: 'Triggers + cola', nodos: [
 { tabla: 'costos_articulo', label: 'Costo por articulo', desc: 'Costo resuelto ligado a articulo_id', funcion: '/precios/importar/[id]/costos', trigger: 'tg_encolar_recalculo, trigger_recalcular_precios_async' },
 { tabla: 'costos_pendientes', label: 'Costos pendientes', desc: 'Costos por resolver', funcion: 'trigger' },
 ]},
 { id: 5, titulo: '5. Reglas y recalculo', motor: 'CRON process-precio-queue', nodos: [
 { tabla: 'precio_recalc_queue', label: 'Cola recalculo', desc: 'Items en espera de recalcular precio', funcion: '/api/cron/process-precio-queue' },
 { tabla: 'pricing_rule_v3', label: 'Reglas v3', desc: 'Motor de reglas vigente', funcion: '/api/pricing-rules' },
 { tabla: 'pricing_rules', label: 'Reglas (prev)', desc: 'Motor de reglas anterior', funcion: '/api/pricing-rules' },
 { tabla: 'reglas_precio', label: 'Reglas (base)', desc: 'Tabla de reglas base', funcion: '-' },
 ]},
 { id: 6, titulo: '6. Publicacion', motor: 'API publish + triggers', nodos: [
 { tabla: 'publicaciones_externas', label: 'Publicaciones', desc: 'Anuncios en marketplace', funcion: '/api/publish', trigger: 'trg_recalcular_precio_publicacion, trg_limpiar_publicacion_ml' },
 { tabla: 'mapeo_publicacion_articulo', label: 'Mapeo pub-articulo', desc: 'Liga publicacion con articulo', funcion: 'trigger', trigger: 'trg_actualizar_mapeo, trg_ensure_snapshot_on_mapping' },
 { tabla: 'precios_publicacion', label: 'Precio publicacion', desc: 'Precio calculado por publicacion', funcion: 'trigger', trigger: 'trg_sync_price_marketplace_prices' },
 ]},
 { id: 7, titulo: '7. Sincronizacion ML', motor: 'CRON sync-ml-prices + webhook', nodos: [
 { tabla: 'meli_webhook_events', label: 'Eventos webhook', desc: 'Notificaciones entrantes de ML', funcion: '/api/webhooks/meli' },
 { tabla: 'webhook_buffer', label: 'Buffer webhook', desc: 'Cola de eventos por procesar', funcion: '/api/webhooks/meli' },
 { tabla: 'ml_publicacion_sync_queue', label: 'Cola sync pub', desc: 'Publicaciones por sincronizar', funcion: '/api/cron/sync-ml-prices' },
 { tabla: 'marketplace_prices', label: 'Precios marketplace', desc: 'Precio publicado en ML', funcion: 'trigger', trigger: 'trg_marketplace_prices_updated_at' },
 { tabla: 'sync_logs', label: 'Logs sync', desc: 'Registro de sincronizaciones', funcion: 'cron' },
 ]},
 { id: 8, titulo: '8. Ventas e inventario', motor: 'API ventas/sync', nodos: [
 { tabla: 'ordenes', label: 'Ordenes', desc: 'Ventas recibidas', funcion: '/api/ventas' },
 { tabla: 'orden_items', label: 'Items de orden', desc: 'Renglones vendidos', funcion: '/api/ventas' },
 { tabla: 'inventory_snapshot', label: 'Inventario', desc: 'Stock por articulo', funcion: 'trigger', trigger: 'trg_auto_create_inventory_snapshot, trg_encolar_sync_stock' },
 { tabla: 'reservaciones_stock', label: 'Reservas', desc: 'Stock reservado por venta', funcion: 'trigger', trigger: 'trg_sync_reserved_stock' },
 ]},
 { id: 9, titulo: '9. Finanzas (ligada a stock)', motor: '6 triggers -> stock', nodos: [
 { tabla: 'egresos', label: 'Egresos', desc: 'Salidas; ajustan stock automaticamente', funcion: 'trigger', trigger: 'trg_stock_after_*_egreso' },
 { tabla: 'ingresos', label: 'Ingresos', desc: 'Entradas; ajustan stock automaticamente', funcion: 'trigger', trigger: 'trg_stock_after_*_ingreso' },
 ]},
 { id: 10, titulo: '10. Fichas tecnicas (paralela)', motor: 'API fichas/autoficha', nodos: [
 { tabla: 'fichas_tecnicas', label: 'Fichas', desc: 'Ficha tecnica del articulo', funcion: '/api/fichas', trigger: 'trigger_ficha_auditoria, trg_campos_regulatorios' },
 { tabla: 'ficha_extracciones', label: 'Extracciones', desc: 'Datos extraidos de documentos', funcion: '/fichas/[id]/descubrir-productos' },
 { tabla: 'ficha_pdfs', label: 'PDFs', desc: 'PDF generado', funcion: '/fichas/[id]/pdf' },
 { tabla: 'ficha_imagenes', label: 'Imagenes', desc: 'Imagenes de la ficha', funcion: '/fichas/[id]/imagenes' },
 { tabla: 'autoficha_borradores', label: 'Autoficha', desc: 'Borradores automaticos', funcion: '/api/autoficha' },
 ]},
];

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return 's/d';
  return n.toLocaleString('es-MX');
}

// Estado por nodo: rojo si vacio, ambar si <10, verde si tiene datos
function estado(n: number | null | undefined): 'ok' | 'bajo' | 'vacio' | 'sd' {
  if (n === null || n === undefined) return 'sd';
  if (n === 0) return 'vacio';
  if (n < 10) return 'bajo';
  return 'ok';
}

const COLOR: Record<string, { bg: string; bd: string; tx: string }> = {
  ok: { bg: '#ecfdf5', bd: '#10b981', tx: '#065f46' },
  bajo: { bg: '#fffbeb', bd: '#f59e0b', tx: '#92400e' },
  vacio: { bg: '#fef2f2', bd: '#ef4444', tx: '#991b1b' },
  sd: { bg: '#f3f4f6', bd: '#9ca3af', tx: '#374151' },
};

export default function MapaPage() {
  const [conteos, setConteos] = useState<Conteos>({});
  const [gen, setGen] = useState<string>('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modo, setModo] = useState<'supervisor' | 'tecnico'>('supervisor');

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      const r = await fetch('/api/mapa/salud', { cache: 'no-store' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'error');
      setConteos(j.conteos || {});
      setGen(j.generado || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => { cargar(); }, []);

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', background: '#f8fafc', minHeight: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Mapa de flujo del negocio (en vivo)</h1>
          <p style={{ color: '#64748b', margin: '4px 0 0' }}>Datos reales de la base de datos. {gen && ('Actualizado: ' + new Date(gen).toLocaleString('es-MX'))}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setModo(modo === 'supervisor' ? 'tecnico' : 'supervisor')} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>Vista: {modo === 'supervisor' ? 'Supervisor' : 'Tecnico'}</button>
          <button onClick={cargar} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer' }}>{cargando ? 'Cargando...' : 'Recargar'}</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#475569', marginBottom: 16 }}>
        <span><b style={{ color: '#10b981' }}>&#9679;</b> Con datos</span>
        <span><b style={{ color: '#f59e0b' }}>&#9679;</b> Muy pocos (&lt;10)</span>
        <span><b style={{ color: '#ef4444' }}>&#9679;</b> Vacio</span>
        <span><b style={{ color: '#9ca3af' }}>&#9679;</b> Sin dato</span>
      </div>

      {error && <div style={{ background: '#fef2f2', color: '#991b1b', padding: 12, borderRadius: 8, marginBottom: 16 }}>Error: {error}</div>}

      <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 24 }}>
        {CADENA.map((es, i) => (
          <div key={es.id} style={{ display: 'flex', alignItems: 'stretch' }}>
            <div style={{ minWidth: 260, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{es.titulo}</div>
              <div style={{ fontSize: 11, color: '#2563eb', marginBottom: 10 }}>&#9881; {es.motor}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {es.nodos.map((nd) => {
                  const n = nd.tabla ? conteos[nd.tabla] : undefined;
                  const st = estado(n);
                  const c = COLOR[st];
                  return (
                    <div key={nd.label} style={{ background: c.bg, border: '1px solid ' + c.bd, borderLeft: '4px solid ' + c.bd, borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: c.tx }}>{nd.label}</span>
                        <span style={{ fontWeight: 700, fontSize: 13, color: c.tx }}>{fmt(n)}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{nd.desc}</div>
                      {modo === 'tecnico' && (
                        <div style={{ fontSize: 10, color: '#64748b', marginTop: 4, borderTop: '1px dashed #cbd5e1', paddingTop: 4 }}>
                          <div><b>tabla:</b> {nd.tabla || '-'}</div>
                          <div><b>proceso:</b> {nd.funcion}</div>
                          {nd.trigger && <div><b>triggers:</b> {nd.trigger}</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            {i < CADENA.length - 1 && (
              <div style={{ display: 'flex', alignItems: 'center', padding: '0 6px', color: '#94a3b8', fontSize: 22 }}>&#8594;</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
