import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const marketplaceId = searchParams.get('marketplace_id');

    if (!marketplaceId) {
        // Buscamos la primera configuración de MeLi si no viene ID
        const { data: config } = await supabaseAdmin
            .from('marketplace_configs')
            .select('id, settings')
            .eq('marketplace', 'meli')
            .limit(1)
            .single();

        if (!config) return NextResponse.json({ error: 'Configuración no encontrada' }, { status: 404 });

        return redirectToMeli(config.id, config.settings.client_id, request);
    }

    const { data: config } = await supabaseAdmin
        .from('marketplace_configs')
        .select('id, settings')
        .eq('id', marketplaceId)
        .single();

    if (!config) return NextResponse.json({ error: 'Configuración no encontrada' }, { status: 404 });

    const clientId = process.env.MELI_CLIENT_ID || config.settings?.client_id;

    if (!clientId) {
        return NextResponse.json({ error: 'Client ID no configurado' }, { status: 400 });
    }

    return redirectToMeli(marketplaceId, clientId, request);
}

function redirectToMeli(marketplaceId: string, clientId: string, request: Request) {
    const host = request.headers.get('host');
    const protocol = host?.includes('localhost') ? 'http' : 'https';
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `${protocol}://${host}`;
    const redirectUri = encodeURIComponent(`${baseUrl}/api/meli/callback`);

    // IMPORTANTE: El state DEBE ser el marketplaceId para saber a qué cuenta asociar el token al volver
    const authUrl = `https://auth.mercadolibre.com.mx/authorization?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${marketplaceId}`;

    console.log('Redirecting to MeLi with ClientID:', clientId, 'State:', marketplaceId);
    return NextResponse.redirect(authUrl);
}
