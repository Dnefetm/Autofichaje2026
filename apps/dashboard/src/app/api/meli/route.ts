import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const marketplaceId = searchParams.get('marketplace_id');
    const clientId = "1828520903959176";
    const redirectUri = "https://autofichaje2026-dashboard-1img.vercel.app/api/meli/callback";

    if (!marketplaceId) {
        // Buscamos la primera configuración de MeLi si no viene ID
        const { data: config } = await supabaseAdmin
            .from('marketplace_configs')
            .select('id')
            .eq('marketplace', 'meli')
            .limit(1)
            .single();

        if (!config) return NextResponse.json({ error: 'Configuración no encontrada' }, { status: 404 });
        return redirectToMeli(config.id, clientId, redirectUri);
    }

    return redirectToMeli(marketplaceId, clientId, redirectUri);
}

function redirectToMeli(marketplaceId: string, clientId: string, redirectUri: string) {
    const authUrl = `https://auth.mercadolibre.com.mx/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${marketplaceId}`;
    console.log('Redirecting to MeLi with ClientID:', clientId, 'State:', marketplaceId);
    return NextResponse.redirect(authUrl);
}
