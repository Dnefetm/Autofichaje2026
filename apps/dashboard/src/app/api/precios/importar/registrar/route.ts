import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { proveedor, fileName, storagePath, bucket = 'excel-precios' } = await req.json();
  if (!proveedor || !fileName || !storagePath) {
    return NextResponse.json({ ok: false, error: 'proveedor, fileName y storagePath requeridos' }, { status: 400 });
  }

  // Verificar que el archivo existe en Storage (anti-fantasma)
  const { data: head, error: headErr } = await supabaseAdmin.storage
    .from(bucket)
    .list(storagePath.split('/').slice(0, -1).join('/'), { search: storagePath.split('/').pop() });
  if (headErr || !head?.length) {
    return NextResponse.json({ ok: false, error: 'Archivo no encontrado en Storage' }, { status: 404 });
  }

  // Reutilizar mapeo previo del proveedor
  const { data: prev } = await supabaseAdmin
    .from('importaciones_excel')
    .select('mapeo_columnas, tipo_costo_default')
    .eq('proveedor', proveedor)
    .not('mapeo_columnas', 'is', null)
    .order('creado_el', { ascending: false })
    .limit(1).maybeSingle();

  const baseMapeo = (prev?.mapeo_columnas as object) ?? {};

  const { data: imp, error } = await supabaseAdmin
    .from('importaciones_excel')
    .insert({
      nombre_archivo: fileName,
      proveedor,
      estado: 'pendiente_mapeo',
      mapeo_columnas: { ...baseMapeo, _storage_path: storagePath, _bucket: bucket },
      tipo_costo_default: prev?.tipo_costo_default ?? null,
    })
    .select('id')
    .single();

  if (error || !imp) {
    // Limpieza: borrar el archivo recién subido si el insert falló
    await supabaseAdmin.storage.from(bucket).remove([storagePath]);
    return NextResponse.json({ ok: false, error: error?.message ?? 'No se pudo registrar' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    importacion_id: imp.id,
    mapeo_previo: prev?.mapeo_columnas ?? null,
    tipo_costo_previo: prev?.tipo_costo_default ?? null,
  });
}
