import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { decrypt } from '@gestor/shared';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const path = searchParams.get('path');
        if(!path) return NextResponse.json({error: 'no path'});
        
        const { data: tokenRow } = await supabaseAdmin.from('marketplace_tokens').select('access_token').not('access_token', 'is', null).limit(1).single();
        const token = decrypt(tokenRow.access_token);
        
        const res = await fetch(`https://api.mercadolibre.com${path}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        return NextResponse.json(json);
    } catch(e: any) {
        return NextResponse.json({ error: e.message });
    }
}
