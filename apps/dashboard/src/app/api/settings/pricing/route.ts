import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
    const { data: rules } = await supabase.from('pricing_rules').select('*').eq('is_active', true);
    const { data: commissions } = await supabase.from('meli_category_commissions').select('*').eq('is_current', true);
    return NextResponse.json({ rules: rules || [], commissions: commissions || [] });
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { type, data } = body;

        if (type === 'global_rule') {
            const { id, margin, marketplace_id } = data;
            // Actualizamos la regla global
            if (id) {
                await supabase.from('pricing_rules').update({ value: margin, updated_at: new Date().toISOString() }).eq('id', id);
            } else {
                await supabase.from('pricing_rules').insert({
                    marketplace_id,
                    rule_type: 'margin_percentage',
                    value: margin,
                    is_active: true
                });
            }
        } else if (type === 'category_commission') {
            const { marketplace_id, category_id, commission_percentage, fixed_fee_threshold } = data;
            
            // Insertar o actualizar
            await supabase.from('meli_category_commissions').upsert({
                marketplace_id,
                category_id,
                commission_percentage,
                fixed_fee_threshold,
                is_current: true
            }, { onConflict: 'marketplace_id, category_id, is_current' });
        } else if (type === 'delete_category') {
            await supabase.from('meli_category_commissions').delete().eq('id', data.id);
        }
        
        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
