import { NextResponse } from 'next/server';
import axios from 'axios';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const marketplaceId = searchParams.get('state');

    console.log('--- MELI CALLBACK RECEIVED ---');
    console.log('Code:', code);
    console.log('State (MarketplaceId):', marketplaceId);

    if (!code) {
        return NextResponse.json({ error: 'Falta código de autorización' }, { status: 400 });
    }

    try {
        // Si no viene state, buscamos la primera configuración de MeLi activa
        let finalMarketplaceId = marketplaceId;
        if (!finalMarketplaceId) {
            const { data: meliConfig } = await supabaseAdmin
                .from('marketplace_configs')
                .select('id')
                .eq('marketplace', 'meli')
                .limit(1)
                .single();
            finalMarketplaceId = meliConfig?.id;
        }

        if (!finalMarketplaceId) {
            throw new Error('No se especificó ni se encontró una configuración de Marketplace válida');
        }

        // 1. Obtener Client ID y Secret de la DB
        const { data: config } = await supabaseAdmin
            .from('marketplace_configs')
            .select('settings')
            .eq('id', finalMarketplaceId)
            .single();

        if (!config) throw new Error('Configuración no encontrada en la base de datos');

        const { client_id, client_secret } = config.settings;
        const host = request.headers.get('host');
        const protocol = host?.includes('localhost') ? 'http' : 'https';
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `${protocol}://${host}`;

        // El redirect URI debe coincidir EXACTAMENTE con el configurado en MeLi
        const redirectUri = `${baseUrl}/api/meli/callback`;

        // 2. Intercambiar código por tokens
        const response = await axios.post('https://api.mercadolibre.com/oauth/token', null, {
            params: {
                grant_type: 'authorization_code',
                client_id: client_id,
                client_secret: client_secret,
                code: code,
                redirect_uri: redirectUri
            }
        });

        const { access_token, refresh_token, expires_in } = response.data;
        const { encrypt } = await import('@/../../packages/shared/lib/crypto');

        // 3. Guardar tokens en la base de datos (Encriptados)
        const { error: tokenError } = await supabaseAdmin
            .from('marketplace_tokens')
            .upsert({
                marketplace_id: finalMarketplaceId,
                access_token: encrypt(access_token),
                refresh_token: encrypt(refresh_token),
                expires_at: new Date(Date.now() + expires_in * 1000).toISOString()
            });

        if (tokenError) throw tokenError;

        return NextResponse.redirect(`${baseUrl}/settings?auth=success`);

    } catch (error: any) {
        console.error('Error en MeLi Callback:', error.response?.data || error.message);
        const host = request.headers.get('host');
        const protocol = host?.includes('localhost') ? 'http' : 'https';
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `${protocol}://${host}`;
        return NextResponse.redirect(`${baseUrl}/settings?auth=error&msg=${encodeURIComponent(error.message)}`);
    }
}
