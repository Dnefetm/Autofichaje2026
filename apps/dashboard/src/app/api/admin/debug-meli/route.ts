import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@/../../../packages/adapters/meli';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const path = searchParams.get('path');
        if(!path) return NextResponse.json({error: 'no path'});
        
        const adapter = new MeliAdapter();
        const accountId = searchParams.get('account_id');
        let finalAccountId = accountId;
        
        if (!finalAccountId) {
            const { data: mTokens } = await supabaseAdmin.from('marketplace_tokens')
                .select('marketplace_id')
                .not('access_token', 'is', null)
                .order('expires_at', { ascending: false })
                .limit(1)
                .single();
            finalAccountId = mTokens.marketplace_id;
        }
        const token = await adapter.getAccessToken(finalAccountId);
        
        const res = await fetch(`https://api.mercadolibre.com${path}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        return NextResponse.json(json);
    } catch(e: any) {
        return NextResponse.json({ error: e.message });
    }
}
