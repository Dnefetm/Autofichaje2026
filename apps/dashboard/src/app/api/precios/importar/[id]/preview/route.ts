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
import ExcelJS from 'exceljs';

export const dynamic = 'force-dynamic';

const PREVIEW_ROWS = 10;

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
    .select('id, nombre_archivo, proveedor, mapeo_columnas, tipo_costo_default, estado')
    .eq('id', id)
    .single();

  if (fetchErr || !importacion) {
    return NextResponse.json({ ok: false, error: 'Importacion no encontrada' }, { status: 404 });
  }

  // Fix C: si la importacion ya no esta activa, corto-circuitar con un error
  // que el frontend (PasoMapear catch) reconoce para redirigir a /precios/importar.
  if (importacion.estado === 'completado' || importacion.estado === 'cancelado') {
    return NextResponse.json(
      { ok: false, error: 'Esta importación ya no está activa', estado: importacion.estado },
      { status: 409 }
    );
  }

  const mapeoActual = importacion.mapeo_columnas as Record<string, any> | null;
  const storagePath = mapeoActual?._storage_path as string | undefined;
  const bucket = (mapeoActual?._bucket as string | undefined) || 'excel-precios';

  if (!storagePath) {
    return NextResponse.json({ ok: false, error: 'No hay archivo asociado a esta importacion' }, { status: 422 });
  }

  const { data: fileData, error: downloadErr } = await supabaseAdmin.storage.from(bucket).download(storagePath);
  if (downloadErr || !fileData) {
    return NextResponse.json({ ok: false, error: `No se pudo leer el archivo: ${downloadErr?.message}` }, { status: 500 });
  }

  const arrayBuffer = await fileData.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return NextResponse.json({ ok: false, error: 'El archivo Excel no contiene hojas de calculo' }, { status: 422 });
  }

  const allRows: any[][] = [];
  sheet.eachRow((row) => {
    const values = (row.values as any[]).slice(1);
    allRows.push(values.map((v) => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'object' && 'result' in v) return String(v.result);
      if (typeof v === 'object' && 'text' in v) return String(v.text);
      return String(v);
    }));
  });

  if (allRows.length === 0) {
    return NextResponse.json({ ok: false, error: 'El archivo Excel esta vacio' }, { status: 422 });
  }

  const headers = allRows[0] ?? [];
  const dataRows = allRows.slice(1, PREVIEW_ROWS + 1);
  const totalRows = Math.max(0, allRows.length - 1);

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
