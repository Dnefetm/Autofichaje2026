import { NextResponse } from 'next/server';
import axios from 'axios';
import { supabaseAdmin } from '@/lib/supabase';
import { encrypt } from '../../../../../../packages/shared/lib/crypto';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const marketplaceId = searchParams.get('state');

    const clientId = "1828520903959176";
    const clientSecret = "4YB5vjSGlbJkgp9ni4UwxUx5UdgRcJcU";
    const redirectUri = "https://autofichaje2026-dashboard-1img.vercel.app/api/meli/callback";
    const baseUrl = "https://autofichaje2026-dashboard-1img.vercel.app";

    console.log('--- MELI CALLBACK RECEIVED ---');
    console.log('Code:', code);
    console.log('State (MarketplaceId):', marketplaceId);

    if (!code) {
        return NextResponse.redirect(`${baseUrl}/settings?auth=error&msg=Falta+codigo+de+autorizacion`);
    }

    try {
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

        // 2. Intercambiar código por tokens
        const response = await axios.post('https://api.mercadolibre.com/oauth/token', null, {
            params: {
                grant_type: 'authorization_code',
                client_id: clientId,
                client_secret: clientSecret,
                code: code,
                redirect_uri: redirectUri
            }
        });

        const { access_token, refresh_token, expires_in } = response.data;

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
        return NextResponse.redirect(`${baseUrl}/settings?auth=error&msg=${encodeURIComponent(error.message)}`);
    }
}
