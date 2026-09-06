import { friendlyError } from '@/lib/friendlyError';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const articulo_id = searchParams.get('articulo_id');
    const regla_id = searchParams.get('regla_id');

    if (!articulo_id || !regla_id) {
        return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400 });
    }

    try {
        const { data, error } = await supabaseAdmin.rpc('fn_calcular_precio_publico', {
            p_articulo_id: articulo_id,
            p_regla_id: regla_id
        });

        if (error) throw error;

        const { data: costoRow } = await supabaseAdmin
            .from('costos_articulo')
            .select('valor')
            .eq('articulo_id', articulo_id)
            .eq('vigente', true)
            .order('tipo_costo', { ascending: true })
            .limit(1)
            .single();

        const { data: regla } = await supabaseAdmin
            .from('reglas_precio')
            .select('*')
            .eq('id', regla_id)
            .single();

        return NextResponse.json({
            precio_final: data,
            desglose: {
                costo_base: costoRow?.valor || 0,
                costos_fijos: regla?.costos_fijos || 0,
                margen_pct: regla?.margen_pct || 0,
                retenciones_json: regla?.retenciones || []
            }
        });
    } catch (e: any) {
        return NextResponse.json({ error: friendlyError(e) }, { status: 500 });
    }
}
