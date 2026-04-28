import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
    const { data: rules } = await supabaseAdmin
        .from('pricing_rule_v3')
        .select('*')
        .order('priority', { ascending: true });
        
    const { data: commissions } = await supabaseAdmin
        .from('meli_category_commissions')
        .select('*')
        .eq('is_current', true)
        .order('category_id', { ascending: true });
        
    return NextResponse.json({ rules: rules || [], commissions: commissions || [] });
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { type, data } = body;

        if (type === 'upsert_rule_v3') {
            const { error } = await supabaseAdmin.from('pricing_rule_v3').upsert(data, { onConflict: 'id' });
            if (error) throw error;
        } else if (type === 'delete_rule_v3') {
            const { error } = await supabaseAdmin.from('pricing_rule_v3').delete().eq('id', data.id);
            if (error) throw error;
        } else if (type === 'category_commission') {
            // ... Meli category code ... 
            const { marketplace_id, category_id, commission_percentage, fixed_fee_threshold } = data;
            const { error } = await supabaseAdmin.from('meli_category_commissions').upsert({
                marketplace_id,
                category_id,
                commission_percentage,
                fixed_fee_threshold,
                is_current: true
            }, { onConflict: 'marketplace_id, category_id, is_current' });
            if (error) throw error;
        } else if (type === 'delete_category') {
            const { error } = await supabaseAdmin.from('meli_category_commissions').delete().eq('id', data.id);
            if (error) throw error;
        }
        
        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
