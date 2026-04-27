import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const marketplace_id = searchParams.get('marketplace_id');

    if (!marketplace_id) {
        return NextResponse.json({ ok: false, error: 'marketplace_id is required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
        .from('pricing_rules')
        .select('*')
        .eq('marketplace_id', marketplace_id)
        .order('priority', { ascending: false })
        .limit(1);

    if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, rule: data?.[0] || null });
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { marketplace_id, name, rule_type, value, ml_commission_percentage, tax_percentage, ml_fixed_fee } = body;

    if (!marketplace_id || value == null) {
        return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
        .from('pricing_rules')
        .upsert({
            marketplace_id,
            name: name || 'Regla Dinámica',
            rule_type: rule_type || 'margin_percentage',
            value,
            ml_commission_percentage,
            tax_percentage,
            ml_fixed_fee,
            is_active: true
        }, { onConflict: 'marketplace_id' })
        .select()
        .single();

    if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    // 3. Trigger recalculation (optional via db or let user wait for next update, 
    // actually let's trigger the recalc function here for ALL items!)
    await supabaseAdmin.rpc('fn_recalcular_precio_marketplace_all', { p_marketplace_id: marketplace_id }).catch(() => null);

    return NextResponse.json({ ok: true, rule: data });
}
