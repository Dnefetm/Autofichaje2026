import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
    try {
        const { data, error } = await supabaseAdmin
            .from('reglas_precio')
            .select('id, nombre, prioridad')
            .order('prioridad', { ascending: true });

        if (error) throw error;
        return NextResponse.json({ reglas: data || [] });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
