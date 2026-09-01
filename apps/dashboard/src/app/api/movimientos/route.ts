import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// POST /api/movimientos — la web registra/edita un movimiento vía RPC web_upsert_*
// Body: { tipo: 'ingreso'|'egreso'|'articulo', ...campos }
// El RPC escribe con origin='web' y el trigger encola el sync_outbox; el Apps Script
// reverso (sincSupabaseASheets) lo baja a Sheets.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tipo, ...campos } = body;

    let fn: string;
    let args: Record<string, unknown>;

    if (tipo === 'ingreso') {
      fn = 'web_upsert_ingreso';
      args = {
        p_ingreso_id: campos.ingreso_id,
        p_articulo_id: campos.articulo_id,
        p_cantidad: campos.cantidad,
        p_guia: campos.guia ?? null,
        p_transportista: campos.transportista ?? null,
        p_tipo_ingreso: campos.tipo_ingreso ?? null,
        p_notas: campos.notas ?? null,
        p_fecha: campos.fecha ?? null,
        p_operador_id: campos.operador_id ?? null,
      };
    } else if (tipo === 'egreso') {
      fn = 'web_upsert_egreso';
      args = {
        p_egreso_id: campos.egreso_id,
        p_articulo_id: campos.articulo_id,
        p_cantidad: campos.cantidad,
        p_tipo_egreso: campos.tipo_egreso ?? null,
        p_importacion_full_id: campos.importacion_full_id ?? null,
        p_guia: campos.guia ?? null,
        p_transportista: campos.transportista ?? null,
        p_operador_id: campos.operador_id ?? null,
        p_notas: campos.notas ?? null,
        p_fecha: campos.fecha ?? null,
        p_largo: campos.largo ?? null,
        p_ancho: campos.ancho ?? null,
        p_alto: campos.alto ?? null,
        p_peso: campos.peso ?? null,
        p_salidas_periodo: campos.salidas_periodo ?? null,
        p_codigo_ml: campos.codigo_ml ?? null,
        p_edo_reunido: campos.edo_reunido ?? null,
        p_fecha_reunido: campos.fecha_reunido ?? null,
        p_fecha_preparado: campos.fecha_preparado ?? null,
      };
    } else if (tipo === 'articulo') {
      fn = 'web_upsert_articulo';
      args = {
        p_articulo_id: campos.articulo_id,
        p_nombre: campos.nombre ?? null,
        p_marca: campos.marca ?? null,
        p_modelo: campos.modelo ?? null,
        p_variante: campos.variante ?? null,
        p_categoria: campos.categoria ?? null,
        p_caja_madre: campos.caja_madre ?? null,
        p_codigo_universal: campos.codigo_universal ?? null,
        p_codigo_sat: campos.codigo_sat ?? null,
        p_url_producto: campos.url_producto ?? null,
        p_notas: campos.notas ?? null,
        p_peso_kg: campos.peso_kg ?? null,
        p_es_full: campos.es_full ?? null,
        p_es_dropshipping: campos.es_dropshipping ?? null,
        p_descripcion: campos.descripcion ?? null,
        p_largo_cm: campos.largo_cm ?? null,
        p_ancho_cm: campos.ancho_cm ?? null,
        p_alto_cm: campos.alto_cm ?? null,
        p_imagenes: campos.imagenes ?? null,
      };
    } else {
      return NextResponse.json({ error: 'tipo inválido: usa ingreso|egreso|articulo' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.rpc(fn, args);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[POST /api/movimientos]', err?.message || err);
    return NextResponse.json({ error: err?.message || 'error' }, { status: 500 });
  }
}
