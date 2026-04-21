import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { ImportacionEstado } from '@/lib/types/importacion';

export const dynamic = 'force-dynamic';

const ACTIVOS = ['pendiente_mapeo', 'mapeando', 'procesando'] as const;

export async function POST(req: NextRequest) {
  const { proveedor, fileName, storagePath, bucket = 'excel-precios' } = await req.json();

  if (!proveedor || !fileName || !storagePath) {
    return NextResponse.json({ ok: false, error: 'proveedor, fileName y storagePath requeridos' }, { status: 400 });
  }

  // Lock: rechazar si ya hay una importacion activa para el proveedor
  const { data: activa } = await supabaseAdmin
    .from('importaciones_excel')
    .select('id, estado, nombre_archivo, creado_el')
    .eq('proveedor', proveedor)
    .in('estado', ACTIVOS as unknown as string[])
    .order('creado_el', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activa) {
    // Limpiar archivo recien subido para no dejar basura en Storage
    await supabaseAdmin.storage.from(bucket).remove([storagePath]);
    return NextResponse.json(
      { ok: false, error: 'Ya existe una importacion activa para este proveedor', importacion_activa: activa },
      { status: 409 }
    );
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
      estado: 'pendiente_mapeo' satisfies ImportacionEstado,
      mapeo_columnas: { ...baseMapeo, _storage_path: storagePath, _bucket: bucket },
      tipo_costo_default: prev?.tipo_costo_default ?? null,
    })
    .select('id')
    .single();

  if (error || !imp) {
    // Limpieza: borrar el archivo recien subido si el insert fallo
    await supabaseAdmin.storage.from(bucket).remove([storagePath]);
    // 23505 = unique_violation (indice parcial de importacion activa)
    const isDup = (error as { code?: string } | null)?.code === '23505';
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'No se pudo registrar' },
      { status: isDup ? 409 : 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    importacion_id: imp.id,
    mapeo_previo: prev?.mapeo_columnas ?? null,
    tipo_costo_previo: prev?.tipo_costo_default ?? null,
  });
}
