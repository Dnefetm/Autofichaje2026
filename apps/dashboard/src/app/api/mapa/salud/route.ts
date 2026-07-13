import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
export const dynamic = 'force-dynamic';
const TABLAS = ['importaciones_excel','listas_precios_raw','listas_precios_raw_staging','lista_precios_proveedor','listas_precios_proveedor','precios_proveedor_actual','matching_decisiones','matching_jobs','matching_resultados','proveedor_articulos_alias','costos_articulo','costos_pendientes','precio_recalc_queue','reglas_precio','pricing_rules','pricing_rule_v3','articulos','fichas_tecnicas','ficha_extracciones','ficha_pdfs','ficha_imagenes','autoficha_borradores','publicaciones_externas','mapeo_publicacion_articulo','precios_publicacion','precios_publicados','marketplace_prices','marketplace_settlements','meli_webhook_events','webhook_buffer','ml_publicacion_sync_queue','sync_logs','historial_cambios_precio','ordenes','orden_items','inventory_snapshot','reservaciones_stock','egresos','ingresos','marcas','fabricantes','fuentes_documento','marketplace_configs','ficha_auditoria','importacion_eventos','jobs','operadores'];
const ARISTAS: [string,string,string][] = [['costos_articulo','articulo_id','articulos'],['costos_articulo','importacion_id','importaciones_excel'],['costos_pendientes','importacion_id','importaciones_excel'],['proveedor_articulos_alias','articulo_id','articulos'],['precios_proveedor_actual','fila_raw_origen','listas_precios_raw'],['precios_proveedor_actual','importacion_origen','importaciones_excel'],['lista_precios_proveedor','importacion_id','importaciones_excel'],['listas_precios_proveedor','importacion_id','importaciones_excel'],['listas_precios_raw','importacion_id','importaciones_excel'],['listas_precios_raw_staging','importacion_id','importaciones_excel'],['importacion_eventos','importacion_id','importaciones_excel'],['matching_jobs','lista_precios_id','listas_precios_proveedor'],['ficha_auditoria','ficha_tecnica_id','fichas_tecnicas'],['ficha_extracciones','ficha_tecnica_id','fichas_tecnicas'],['ficha_extracciones','fuente_documento_id','fuentes_documento'],['ficha_imagenes','ficha_id','fichas_tecnicas'],['ficha_pdfs','ficha_tecnica_id','fichas_tecnicas'],['fichas_tecnicas','publicacion_externa_id','publicaciones_externas'],['fichas_tecnicas','marca_id','marcas'],['fichas_tecnicas','articulo_id','articulos'],['fichas_tecnicas','fabricante_id','fabricantes'],['precios_publicacion','regla_aplicada_id','reglas_precio'],['precios_publicacion','marketplace_id','marketplace_configs'],['precios_publicacion','publicacion_id','publicaciones_externas'],['precios_publicacion','articulo_id','articulos'],['precios_publicados','articulo_id','articulos'],['precios_publicados','regla_id','reglas_precio'],['mapeo_publicacion_articulo','publicacion_id','publicaciones_externas'],['mapeo_publicacion_articulo','articulo_id','articulos'],['marketplace_prices','articulo_id','articulos'],['marketplace_prices','marketplace_id','marketplace_configs'],['pricing_rules','marketplace_id','marketplace_configs'],['reglas_precio','marketplace_id','marketplace_configs'],['historial_cambios_precio','precio_publicacion_id','precios_publicacion'],['inventory_snapshot','sku','articulos'],['orden_items','orden_id','ordenes'],['orden_items','articulo_id','articulos'],['orden_items','publicacion_id','publicaciones_externas'],['ordenes','marketplace_id','marketplace_configs'],['reservaciones_stock','articulo_id','articulos'],['reservaciones_stock','orden_item_id','orden_items'],['egresos','operador_id','operadores'],['ingresos','operador_id','operadores'],['marcas','marca_padre_id','marcas'],['marcas','fabricante_id','fabricantes'],['sync_logs','marketplace_id','marketplace_configs'],['sync_logs','job_id','jobs']];
const HUERFANAS = ['matching_decisiones','meli_webhook_events','webhook_buffer','app_config','autoficha_borradores','categoria_plantillas','importacion_estado_transiciones','proveedor_locks','system_alerts','system_metrics','tipos_cambio','webhook_config'];
async function contar(t: string): Promise<number | null> {
const { count, error } = await supabaseAdmin.from(t).select('*', { count: 'exact', head: true });
if (error) return null;
return count ?? 0;
}
export async function GET() {
try {
const pares = await Promise.all(TABLAS.map(async (t) => [t, await contar(t)] as const));
const conteos: Record<string, number | null> = {};
for (const [t, n] of pares) conteos[t] = n;
const aristas = ARISTAS.map(([origen, col, destino]) => {
const co = conteos[origen]; const cd = conteos[destino];
let estado = 'viva';
if (co === 0) estado = 'sin_uso'; else if (cd === 0) estado = 'rota';
return { origen, col, destino, estado, filas_origen: co ?? null, filas_destino: cd ?? null };
});
const huerfanas = HUERFANAS.map((t) => ({ tabla: t, filas: conteos[t] ?? null }));
const { data: dicc } = await supabaseAdmin.from('mapa_diccionario').select('*').order('orden', { ascending: true });
return NextResponse.json({ ok: true, generado: new Date().toISOString(), conteos, aristas, huerfanas, diccionario: dicc ?? [], resumen: { tablas: TABLAS.length, aristas: aristas.length, rotas: aristas.filter(a => a.estado === 'rota').length, sin_uso: aristas.filter(a => a.estado === 'sin_uso').length } });
} catch (e: unknown) {
const msg = e instanceof Error ? e.message : 'error';
return NextResponse.json({ ok: false, error: msg }, { status: 500 });
}
}


const CAMPOS_EDITABLES = ['nombre', 'etapa', 'descripcion', 'proposito', 'entradas', 'salidas', 'responsable', 'orden'] as const;
export async function PATCH(req: Request) {
try {
const body = await req.json();
const clave = typeof body?.clave === 'string' ? body.clave.trim() : '';
if (!clave) return NextResponse.json({ ok: false, error: 'falta clave' }, { status: 400 });
const updates: Record<string, unknown> = {};
for (const c of CAMPOS_EDITABLES) { if (c in (body ?? {})) updates[c] = body[c]; }
if (Object.keys(updates).length === 0) return NextResponse.json({ ok: false, error: 'sin campos a actualizar' }, { status: 400 });
const { data, error } = await supabaseAdmin.from('mapa_diccionario').update(updates).eq('clave', clave).select();
if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
if (!data || data.length === 0) return NextResponse.json({ ok: false, error: 'clave no encontrada' }, { status: 404 });
return NextResponse.json({ ok: true, actualizado: data[0] });
} catch (e: unknown) {
const msg = e instanceof Error ? e.message : 'error';
return NextResponse.json({ ok: false, error: msg }, { status: 500 });
}
}
