import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request) {
    const { pendiente_id, articulo_id, proveedor, codigo_excel, marca_excel, modelo_excel } = await req.json();

    if (!articulo_id || !proveedor) {
        return NextResponse.json({ error: 'Faltan datos requeridos' }, { status: 400 });
    }

    try {
        const { error } = await supabaseAdmin.from('proveedor_articulos_alias').insert({
            proveedor,
            articulo_id,
            codigo_excel: codigo_excel || null,
            marca_excel: marca_excel || null,
            modelo_excel: modelo_excel || null
        });

        if (error) {
            if (error.code === '23505') {
                 await supabaseAdmin.from('proveedor_articulos_alias').update({ articulo_id })
                    .match({ proveedor, codigo_excel });
                 
                 const { data: pendiente } = await supabaseAdmin.from('costos_pendientes').select('*').eq('id', pendiente_id).single();
                 if (pendiente) {
                     await supabaseAdmin.from('costos_articulo').upsert({
                         importacion_id: pendiente.importacion_id,
                         articulo_id: articulo_id,
                         articulo_sugerido_id: articulo_id,
                         tipo_costo: pendiente.tipo_costo,
                         valor: pendiente.valor,
                         moneda: pendiente.moneda,
                         fuente: 'excel',
                         puntaje_match: 100,
                         estado_match: 'completado',
                         vigente: true
                     }, { onConflict: 'articulo_id,tipo_costo,fuente' });
                     
                     await supabaseAdmin.from('costos_pendientes').update({ resuelto: true }).eq('id', pendiente_id);
                 }
            } else {
                throw error;
            }
        }

        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
