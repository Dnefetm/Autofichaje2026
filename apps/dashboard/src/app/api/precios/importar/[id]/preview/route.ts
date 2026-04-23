/**
 * GET /api/precios/importar/[id]/preview
 *
 * Lee el Excel desde Supabase Storage y devuelve:
 *   - headers, rows, total_rows
 *   - mapeo_previo: object|null (prioriza mapeo propio; fallback a ultima importacion
 *                                'completado' del mismo proveedor)
 *   - tipo_costo_previo: string|null
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

function sanitizeMapeo(raw: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!raw) return null;
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([k]) => !k.startsWith('_'))
  );
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;

  const { data: importacion, error: fetchErr } = await supabaseAdmin
    .from('importaciones_excel')
    .select('id, nombre_archivo, proveedor, mapeo_columnas, tipo_costo_default, estado, total_filas')
    .eq('id', id)
    .single();

  if (fetchErr || !importacion) {
    return NextResponse.json({ ok: false, error: 'Importacion no encontrada' }, { status: 404 });
  }

  // Fix C: si la importacion ya no esta activa, corto-circuitar con un error
  // que el frontend (PasoMapear catch) reconoce para redirigir a /precios/importar.
  if (importacion.estado === 'cancelado') {
    return NextResponse.json(
      { ok: false, error: 'Esta importación ha sido cancelada', estado: importacion.estado },
      { status: 409 }
    );
  }

  const mapeoActual = importacion.mapeo_columnas as Record<string, any> | null;

  // Consultar las 10 primeras filas directo de la tabla de listas (ya que staging se limpia tras consolidar)
  const { data: rawRows, error: rawErr } = await supabaseAdmin
    .from('listas_precios_raw')
    .select('payload, fila_num')
    .eq('importacion_id', id)
    .order('fila_num', { ascending: true })
    .limit(10);

  if (rawErr) {
     return NextResponse.json({ ok: false, error: 'Error leyendo preview de base de datos' }, { status: 500 });
  }

  // Si no hay headers guardados explícitamente en mapeo_columnas, inferirlos de la fila 1
  let headers: string[] = [];
  const dataRows: string[][] = [];
  
  if (rawRows && rawRows.length > 0) {
      headers = Object.keys(rawRows[0].payload as Record<string, any>);
      
      for (const r of rawRows) {
          const dict = r.payload as Record<string, string>;
          const rowArr = headers.map(h => dict[h] ?? '');
          dataRows.push(rowArr);
      }
  }

  const totalRows = importacion.total_filas || 0;

  // Resolver mapeo previo: (1) mapeo propio de esta importacion; (2) fallback a
  // la ultima importacion 'completado' del mismo proveedor.
  let mapeoPrevio = sanitizeMapeo(mapeoActual);
  let tipoCostoPrevio: string | null = importacion.tipo_costo_default ?? null;

  if (!mapeoPrevio && importacion.proveedor) {
    const { data: ultima } = await supabaseAdmin
      .from('importaciones_excel')
      .select('mapeo_columnas, tipo_costo_default')
      .eq('proveedor', importacion.proveedor)
      .eq('estado', 'completado')
      .neq('id', id)
      .order('creado_el', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ultima) {
      mapeoPrevio = sanitizeMapeo(ultima.mapeo_columnas as Record<string, any> | null);
      if (!tipoCostoPrevio) tipoCostoPrevio = ultima.tipo_costo_default ?? null;
    }
  }

  return NextResponse.json({
    ok: true,
    importacion_id: id,
    nombre_archivo: importacion.nombre_archivo,
    proveedor: importacion.proveedor,
    headers,
    rows: dataRows,
    total_rows: totalRows,
    mapeo_previo: mapeoPrevio,
    tipo_costo_previo: tipoCostoPrevio,
    estado: importacion.estado,
  });
}
