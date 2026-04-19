import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function DELETE(req: Request, { params }: { params: { batchId: string } }) {
  try {
    const headerList = headers();
    const token = headerList.get('authorization')?.split('Bearer ')[1];

    if (!token) {
      return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });
    }

    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) {
      return NextResponse.json({ ok: false, error: 'Usuario inválido' }, { status: 401 });
    }

    // El revert busca el batch, lee sus `precios_historial_proveedor`, restaura los "valor_antiguo" al `costos_articulo`
    // y finalmente elimina el batch (o lo marca revertido).
    
    // Primero buscar los movimientos
    const { data: movimientos, error: movErr } = await supabaseAdmin
        .from('precios_historial_proveedor')
        .select('*')
        .eq('batch_id', params.batchId);
        
    if (movErr) {
        return NextResponse.json({ ok: false, error: movErr.message }, { status: 500 });
    }
    
    if (!movimientos || movimientos.length === 0) {
        // Nada que revertir, borramos el batch de todos modos si estuviera huérfano
        await supabaseAdmin.from('precio_import_batches').delete().eq('id', params.batchId);
        return NextResponse.json({ ok: true, message: 'Batch eliminado, no tenía histótico' });
    }
    
    let revertidos = 0;
    const errores = [];
    
    // Revertir
    for (const mov of movimientos) {
        if (!mov.costo_articulo_id) continue;
        
        // Si había valor antiguo, revertimos. Si valor_antiguo era null (es decir, fue inserción nueva), hay decisiones: 
        // desactivarlo o marcar vigente: false. El modelo de precios asume que "vigente: false" significa desactivado.
        
        const updateData: any = { estado_match: 'sugerido' }; // Se regresa a sugerido
        if (mov.valor_antiguo !== null && mov.valor_antiguo !== undefined) {
            updateData.valor = mov.valor_antiguo; 
            updateData.vigente = true;
        } else {
            // El costo es nuevo enteramente
            updateData.vigente = false; 
        }
        
        const { error: updErr } = await supabaseAdmin
            .from('costos_articulo')
            .update(updateData)
            .eq('id', mov.costo_articulo_id);
            
        if (updErr) {
            errores.push(mov.costo_articulo_id);
        } else {
            revertidos++;
        }
    }
    
    const { data: batch } = await supabaseAdmin.from('precio_import_batches').select('importacion_excel_id').eq('id', params.batchId).single();
    if (batch?.importacion_excel_id) {
        await supabaseAdmin.from('listas_precios_raw').delete().eq('importacion_id', batch.importacion_excel_id);
    }
    
    // Borrar el batch cascadea y borra de historial
    const { error: delErr } = await supabaseAdmin.from('precio_import_batches').delete().eq('id', params.batchId);
    if(delErr) {
       console.error("No se pudo borrar el batch_id después de revertir", delErr);
    }
    
    console.log(JSON.stringify({ event: 'batch_reverted', batchId: params.batchId, user: user.id, revertidos }));
    
    return NextResponse.json({ ok: true, revertidos, errores });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
