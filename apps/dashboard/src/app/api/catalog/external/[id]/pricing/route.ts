import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';

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

    const { data: allRules } = await supabase
        .from('pricing_rule_v3')
        .select('id, name, priority')
        .eq('is_active', true)
        .order('priority', { ascending: true });

    return NextResponse.json({ override: override || null, history: history || [], allRules: allRules || [] });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    
    try {
        const body = await req.json();
        const { override_type, value, force_rule_id, valido_hasta } = body;
        
        if (!override_type || (override_type !== 'force_rule' && value == null) || (override_type === 'force_rule' && !force_rule_id)) {
            // Delete override
            const { error } = await supabaseAdmin.from('publication_pricing_overrides').delete().eq('publicacion_id', id);
            if (error) throw error;
        } else {
            // Upsert override
            const { error } = await supabaseAdmin.from('publication_pricing_overrides').upsert({
                publicacion_id: id,
                override_type,
                value: value || 0,
                force_rule_id: force_rule_id || null,
                valido_hasta: valido_hasta || null,
                updated_at: new Date().toISOString()
            }, { onConflict: 'publicacion_id' });
            if (error) throw error;
        }
        
        // Encolar recálculo asíncrono
        const { error: jobErr } = await supabaseAdmin.from('jobs').insert({
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
        const { error } = await supabaseAdmin.rpc('fn_recalcular_precio_publicacion', {
            p_publicacion_id: id
        });
        
        if (error) throw error;
        
        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message || 'Error forzando recálculo' }, { status: 500 });
    }
}
