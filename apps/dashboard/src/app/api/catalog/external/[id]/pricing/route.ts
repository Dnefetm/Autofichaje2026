import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    
    const { data: override } = await supabase
        .from('publication_pricing_overrides')
        .select('*')
        .eq('publicacion_id', id)
        .maybeSingle();
        
    const { data: history } = await supabase
        .from('publication_pricing_history')
        .select('*')
        .eq('publicacion_id', id)
        .order('created_at', { ascending: false })
        .limit(10);

    return NextResponse.json({ override: override || null, history: history || [] });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    
    try {
        const body = await req.json();
        const { override_type, value, valido_hasta } = body;
        
        if (!override_type || value == null) {
            // Delete override
            const { error } = await supabase.from('publication_pricing_overrides').delete().eq('publicacion_id', id);
            if (error) throw error;
        } else {
            // Upsert override
            const { error } = await supabase.from('publication_pricing_overrides').upsert({
                publicacion_id: id,
                override_type,
                value,
                valido_hasta: valido_hasta || null,
                updated_at: new Date().toISOString()
            }, { onConflict: 'publicacion_id' });
            if (error) throw error;
        }
        
        // Encolar recálculo asíncrono
        const { error: jobErr } = await supabase.from('jobs').insert({
            type: 'recalc_pricing_bundle',
            payload: { publicacion_id: id },
            status: 'pending'
        });
        
        if (jobErr) throw jobErr;

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message || 'Error updating override' }, { status: 500 });
    }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    
    try {
        // Ejecutar el cálculo de forma síncrona para feedback instantáneo en UI
        const { error } = await supabase.rpc('fn_recalcular_precio_publicacion', {
            p_publicacion_id: id
        });
        
        if (error) throw error;
        
        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message || 'Error forzando recálculo' }, { status: 500 });
    }
}
