import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// POST /api/movimientos — la web registra/edita un movimiento vía RPC web_upsert_*
// Body: { tipo: 'ingreso'|'egreso'|'articulo', ...campos }
// El RPC escribe con origin='web' y el trigger encola el sync_outbox; el Apps Script
// reverso (sincSupabaseASheets) lo baja a Sheets.
//
// Regla de negocio: el ÚNICO valor obligatorio es el id del movimiento. Si no llega,
// se auto-genera con crypto.randomUUID(). Todo lo demás es opcional.
// Seguridad: los RPCs no aceptan `imagenes` ni `ubicacion_id` (firma SQL fija); esos
// campos se actualizan en una segunda sentencia directa sobre el id generado
// (mismo patrón que importar-pdf/upsertSalida), sin romper la firma del RPC.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tipo, ...campos } = body;

    let fn: string;
    let args: Record<string, unknown>;
    let movimientoId: string;
    let tabla: 'ingresos' | 'egresos';

    if (tipo === 'ingreso') {
      fn = 'web_upsert_ingreso';
      tabla = 'ingresos';
      movimientoId = campos.ingreso_id || crypto.randomUUID();
      args = {
        p_ingreso_id: movimientoId,
        p_articulo_id: campos.articulo_id ?? null,
        p_cantidad: campos.cantidad ?? 0,
        p_guia: campos.guia ?? null,
        p_transportista: campos.transportista ?? null,
        p_tipo_ingreso: campos.tipo_ingreso ?? null,
        p_notas: campos.notas ?? null,
        p_fecha: campos.fecha ?? new Date().toISOString(),
        p_operador_id: campos.operador_id ?? null,
      };
    } else if (tipo === 'egreso') {
      fn = 'web_upsert_egreso';
      tabla = 'egresos';
      movimientoId = campos.egreso_id || crypto.randomUUID();
      args = {
        p_egreso_id: movimientoId,
        p_articulo_id: campos.articulo_id ?? null,
        p_cantidad: campos.cantidad ?? 0,
        p_tipo_egreso: campos.tipo_egreso ?? null,
        p_importacion_full_id: campos.importacion_full_id ?? null,
        p_guia: campos.guia ?? null,
        p_transportista: campos.transportista ?? null,
        p_operador_id: campos.operador_id ?? null,
        p_notas: campos.notas ?? null,
        p_fecha: campos.fecha ?? new Date().toISOString(),
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

      const { error } = await supabaseAdmin.rpc(fn, args);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    } else {
      return NextResponse.json({ error: 'tipo inválido: usa ingreso|egreso|articulo' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.rpc(fn, args);
    if (error) throw error;

    // Campos fuera de la firma del RPC: imagenes (paths en Storage) y ubicacion_id.
    // Se actualizan directo sobre el id; origin ya quedó en 'web' por el RPC.
    const extras: Record<string, unknown> = {};
    if (Array.isArray(campos.imagenes)) extras.imagenes = campos.imagenes;
    if (campos.ubicacion_id != null) extras.ubicacion_id = campos.ubicacion_id;
    if (Object.keys(extras).length > 0) {
      const col = tabla === 'ingresos' ? 'ingreso_id' : 'egreso_id';
      const { error: updErr } = await supabaseAdmin.from(tabla).update(extras).eq(col, movimientoId);
      if (updErr) throw updErr;
    }

    return NextResponse.json({ ok: true, id: movimientoId });
  } catch (err: any) {
    console.error('[POST /api/movimientos]', err?.message || err);
    return NextResponse.json({ error: err?.message || 'error' }, { status: 500 });
  }
}

// GET /api/movimientos?limit=20 — últimos movimientos (ingresos + egresos) con
// nombre de artículo y fotos, para el mini-historial del operario.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 20, 1), 50);

    const [egresosRes, ingresosRes] = await Promise.all([
      supabaseAdmin
        .from('egresos')
        .select('egreso_id, articulo_id, cantidad, tipo_egreso, fecha, operador_id, notas, imagenes')
        .order('creado_el', { ascending: false })
        .limit(limit),
      supabaseAdmin
        .from('ingresos')
        .select('ingreso_id, articulo_id, cantidad, tipo_ingreso, fecha, operador_id, notas, imagenes')
        .order('creado_el', { ascending: false })
        .limit(limit),
    ]);

    const movs: any[] = [
      ...(egresosRes.data ?? []).map((e: any) => ({
        tipo: 'egreso' as const,
        id: e.egreso_id,
        articulo_id: e.articulo_id,
        cantidad: e.cantidad,
        tipo_movimiento: e.tipo_egreso,
        fecha: e.fecha,
        operador_id: e.operador_id,
        notas: e.notas,
        imagenes: e.imagenes ?? [],
      })),
      ...(ingresosRes.data ?? []).map((i: any) => ({
        tipo: 'ingreso' as const,
        id: i.ingreso_id,
        articulo_id: i.articulo_id,
        cantidad: i.cantidad,
        tipo_movimiento: i.tipo_ingreso,
        fecha: i.fecha,
        operador_id: i.operador_id,
        notas: i.notas,
        imagenes: i.imagenes ?? [],
      })),
    ].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, limit);

    // Nombre del artículo en una sola consulta por lote de ids.
    const artIds = [...new Set(movs.map((m) => m.articulo_id).filter(Boolean))] as string[];
    const nombrePorId = new Map<string, string>();
    if (artIds.length) {
      const { data: arts } = await supabaseAdmin
        .from('articulos')
        .select('articulo_id, nombre')
        .in('articulo_id', artIds);
      for (const a of arts ?? []) nombrePorId.set(a.articulo_id, a.nombre || '');
    }

    return NextResponse.json({
      movimientos: movs.map((m) => ({ ...m, nombre_articulo: nombrePorId.get(m.articulo_id) || null })),
    });
  } catch (err: any) {
    console.error('[GET /api/movimientos]', err?.message || err);
    return NextResponse.json({ error: err?.message || 'error' }, { status: 500 });
  }
}
