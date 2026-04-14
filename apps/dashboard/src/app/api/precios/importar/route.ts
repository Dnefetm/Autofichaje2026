/**
 * POST /api/precios/importar
 *
 * Recibe un archivo Excel (multipart/form-data), lo sube a Supabase Storage
 * en el bucket privado "excel-precios" y crea el registro en importaciones_excel.
 *
 * Form fields esperados:
 *   - file: File (Excel .xlsx/.xls)
 *   - proveedor: string (nombre del proveedor)
 *
 * Responde con el ID del registro creado para que el frontend pueda
 * redirigir al paso de mapeo de columnas.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Tamaño máximo: 10 MB
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
    let formData: FormData;
    try {
        formData = await req.formData();
    } catch {
        return NextResponse.json(
            { ok: false, error: 'No se pudo leer el form-data' },
            { status: 400 }
        );
    }

    const file = formData.get('file') as File | null;
    const proveedor = (formData.get('proveedor') as string | null)?.trim() || 'Sin nombre';

    if (!file) {
        return NextResponse.json({ ok: false, error: 'No se recibió ningún archivo' }, { status: 400 });
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !['xlsx', 'xls'].includes(ext)) {
        return NextResponse.json(
            { ok: false, error: 'Solo se aceptan archivos .xlsx o .xls' },
            { status: 400 }
        );
    }

    if (file.size > MAX_BYTES) {
        return NextResponse.json(
            { ok: false, error: `El archivo excede el límite de ${MAX_BYTES / 1024 / 1024} MB` },
            { status: 413 }
        );
    }

    // ── Asegurar que el bucket exista (privado) ──────────────────────────────
    const BUCKET = 'excel-precios';
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    const bucketExists = buckets?.some((b) => b.name === BUCKET);

    if (!bucketExists) {
        const { error: bucketErr } = await supabaseAdmin.storage.createBucket(BUCKET, {
            public: false,
        });
        if (bucketErr) {
            return NextResponse.json(
                { ok: false, error: `No se pudo crear el bucket: ${bucketErr.message}` },
                { status: 500 }
            );
        }
    }

    // ── Subir archivo a Storage ──────────────────────────────────────────────
    const timestamp = Date.now();
    const storagePath = `${proveedor.replace(/\s+/g, '_')}/${timestamp}_${file.name}`;
    const bytes = await file.arrayBuffer();

    const { error: uploadErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(storagePath, bytes, {
            contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            upsert: false,
        });

    if (uploadErr) {
        return NextResponse.json(
            { ok: false, error: `Error al subir el archivo: ${uploadErr.message}` },
            { status: 500 }
        );
    }

    // ── Crear registro en importaciones_excel ─────────────────────────────────
    // Buscar si el proveedor tiene un mapeo previo guardado
    const { data: prevImport } = await supabaseAdmin
        .from('importaciones_excel')
        .select('mapeo_columnas, tipo_costo_default')
        .eq('proveedor', proveedor)
        .not('mapeo_columnas', 'is', null)
        .order('creado_el', { ascending: false })
        .limit(1)
        .maybeSingle();

    const { data: importacion, error: insertErr } = await supabaseAdmin
        .from('importaciones_excel')
        .insert({
            nombre_archivo: file.name,
            proveedor,
            estado: 'pendiente_mapeo',
            // Sugerencia de mapeo previo si existe
            mapeo_columnas: prevImport?.mapeo_columnas ?? null,
            tipo_costo_default: prevImport?.tipo_costo_default ?? null,
        })
        .select('id, nombre_archivo, proveedor, mapeo_columnas, tipo_costo_default')
        .single();

    if (insertErr || !importacion) {
        // Limpiar el archivo subido si falló el insert
        await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
        return NextResponse.json(
            { ok: false, error: `Error al registrar la importación: ${insertErr?.message}` },
            { status: 500 }
        );
    }

    // Guardar el path de storage en el registro (campo mapeo_columnas temporal o en otro campo)
    // Lo añadimos en mapeo_columnas como metadata de storage_path hasta que se llene el mapeo real
    await supabaseAdmin
        .from('importaciones_excel')
        .update({
            mapeo_columnas: {
                ...(importacion.mapeo_columnas as object ?? {}),
                _storage_path: storagePath,
                _bucket: BUCKET,
            },
        })
        .eq('id', importacion.id);

    return NextResponse.json({
        ok: true,
        importacion_id: importacion.id,
        nombre_archivo: importacion.nombre_archivo,
        proveedor: importacion.proveedor,
        mapeo_previo: prevImport?.mapeo_columnas ?? null,
        tipo_costo_previo: prevImport?.tipo_costo_default ?? null,
    });
}
