import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// =============================================================================
// FEATURE NO IMPLEMENTADO (correccion 2026-08-25, auditoria blueprint Fase 4)
// Este endpoint referenciaba las tablas `precio_import_batches` y
// `precios_historial_proveedor`, que NUNCA han existido en produccion
// (verificado via PostgREST y via extraccion directa de pg_class el 2026-08-25).
// Ademas ninguna ruta crea batches: el frontend nunca recibe batch_id, por lo
// que el boton "Revertir ultimo lote" jamas se renderiza. Era codigo muerto
// que, de ejecutarse, habria fallado con error 500 (tabla inexistente).
// Para habilitarlo de verdad hace falta:
//   1. Aplicar supabase/migrations/v79_consolidar_tablas_fuera_de_banda.sql
//      (crea precio_import_batches + precios_historial_proveedor).
//   2. Cablear la creacion del batch y sus movimientos en la ruta /confirmar.
// Hasta entonces, responder 501 honesto en lugar de un 500 confuso.
// =============================================================================
export async function DELETE(req: Request, props: { params: Promise<{ batchId: string }> }) {
  const headerList = await headers();
  const token = headerList.get('authorization')?.split('Bearer ')[1];
  if (!token) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  }
  const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !user) {
    return NextResponse.json({ ok: false, error: 'Usuario inválido' }, { status: 401 });
  }

  return NextResponse.json(
    {
      ok: false,
      error: 'Revertir lote NO esta implementado: las tablas de batches nunca fueron creadas en produccion y ninguna importacion genera batch_id. Ver comentario en este archivo para el plan de habilitacion.'
    },
    { status: 501 }
  );
}
