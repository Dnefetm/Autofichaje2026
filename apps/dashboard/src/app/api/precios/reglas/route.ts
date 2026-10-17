import { friendlyError } from '@/lib/friendlyError';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request) {
    const payload = await req.json();

    try {
        const { error } = await supabaseAdmin.from('reglas_precio').insert({
            nombre: payload.nombre,
            marketplace_id: null, // canal general → aplica a todas las tiendas
            tipo_publicacion: payload.canal || 'general',
            tipo_costo_base: 'distribuidor',
            margen_porcentaje: Number(payload.margen_porcentaje) || 0,
            margen_fijo: Number(payload.margen_fijo) || 0,
            comision_venta_porcentaje: Number(payload.comision_pago_porcentaje) || 0,
            retencion_marketplace_porcentaje: Number(payload.retencion_marketplace_porcentaje) || 0,
            comision_pago_porcentaje: Number(payload.comision_pago_porcentaje) || 0,
            iva_efectivo_porcentaje: Number(payload.iva_efectivo_porcentaje) || 0,
            iva_porcentaje: Number(payload.iva_efectivo_porcentaje) || 0,
            redondeo: '99',
            prioridad: Number(payload.prioridad) || 0,
            activa: true,
            creado_el: new Date().toISOString(),
            filtro_marca: payload.filtro_marca || null,
            filtro_categoria: payload.filtro_categoria || null,
        });

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ error: friendlyError(e) }, { status: 500 });
    }
}
