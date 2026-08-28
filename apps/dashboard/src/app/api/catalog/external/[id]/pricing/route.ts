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
        const { override_type, value, force_rule_id, valido_hasta, modifiers_override } = body;
        
        if (!override_type && !modifiers_override && value == null && !force_rule_id) {
            // Delete override
            const { error } = await supabaseAdmin.from('publication_pricing_overrides').delete().eq('publicacion_id', id);
            if (error) throw error;
        } else {
            // Upsert override
            const updatePayload: any = {
                publicacion_id: id,
                updated_at: new Date().toISOString()
            };
            if (override_type !== undefined) updatePayload.override_type = override_type;
            if (value !== undefined) updatePayload.value = value || 0;
            if (force_rule_id !== undefined) updatePayload.force_rule_id = force_rule_id;
            if (valido_hasta !== undefined) updatePayload.valido_hasta = valido_hasta;
            if (modifiers_override !== undefined) updatePayload.modifiers_override = modifiers_override;

            const { error } = await supabaseAdmin.from('publication_pricing_overrides').upsert(
                updatePayload, 
                { onConflict: 'publicacion_id' }
            );
            if (error) throw error;
        }
        
        // Ejecutar recálculo síncrono para feedback instantáneo
        try {
            await supabaseAdmin.rpc('fn_recalcular_precio_publicacion', { p_publicacion_id: id });
        } catch (recalcErr) {
            console.error('Error recalculando post-override:', recalcErr);
        }

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
