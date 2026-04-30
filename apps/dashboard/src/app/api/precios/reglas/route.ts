import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request) {
    const payload = await req.json();

    try {
        const { error } = await supabaseAdmin.from('reglas_precio').insert({
            nombre: payload.nombre,
            margen_porcentaje: payload.margen_porcentaje,
            margen_fijo: payload.margen_fijo,
            retencion_marketplace_porcentaje: payload.retencion_marketplace_porcentaje,
            comision_pago_porcentaje: payload.comision_pago_porcentaje,
            iva_efectivo_porcentaje: payload.iva_efectivo_porcentaje,
            filtro_marca: payload.filtro_marca || null,
            filtro_categoria: payload.filtro_categoria || null,
            prioridad: payload.prioridad || 1
        });

        if (error) throw error;
        
        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
