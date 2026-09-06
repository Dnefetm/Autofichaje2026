import { friendlyError } from '@/lib/friendlyError';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request) {
    const payload = await req.json();

    try {
        // La tabla reglas_precio usa: nombre, canal, margen_pct, costos_fijos,
        // retenciones (jsonb array), prioridad, activa, marca_filtro, categoria_filtro.
        const retenciones = [
            { nombre: 'marketplace', porcentaje: Number(payload.retencion_marketplace_porcentaje) || 0 },
            { nombre: 'comision_pago', porcentaje: Number(payload.comision_pago_porcentaje) || 0 },
            { nombre: 'iva', porcentaje: Number(payload.iva_efectivo_porcentaje) || 0 },
        ];

        const { error } = await supabaseAdmin.from('reglas_precio').insert({
            nombre: payload.nombre,
            canal: payload.canal || 'general',
            margen_pct: Number(payload.margen_porcentaje) || 0,
            costos_fijos: Number(payload.margen_fijo) || 0,
            retenciones,
            prioridad: Number(payload.prioridad) || 0,
            activa: true,
            marca_filtro: payload.filtro_marca || null,
            categoria_filtro: payload.filtro_categoria || null,
        });

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ error: friendlyError(e) }, { status: 500 });
    }
}
