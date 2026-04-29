import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request) {
    const { nombre, canal, margen_pct, costos_fijos } = await req.json();

    try {
        const { error } = await supabaseAdmin.from('reglas_precio').insert({
            nombre,
            canal,
            margen_pct,
            costos_fijos
        });

        if (error) throw error;
        
        // Trigger recalculo masivo si es necesario, o encolar...
        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
