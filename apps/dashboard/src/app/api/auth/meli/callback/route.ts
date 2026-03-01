import { NextResponse } from 'next/server';
import axios from 'axios';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const marketplaceId = searchParams.get('state');

    if (!code || !marketplaceId) {
        return NextResponse.json({ error: 'Falta código de autorización o estado' }, { status: 400 });
    }

    try {
        // 1. Obtener Client ID y Secret de la DB
        const { data: config } = await supabaseAdmin
            .from('marketplace_configs')
            .select('settings')
            .eq('id', marketplaceId)
            .single();

        if (!config) throw new Error('Configuración no encontrada');

        const { client_id, client_secret } = config.settings;
        const host = request.headers.get('host');
        const protocol = host?.includes('localhost') ? 'http' : 'https';
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `${protocol}://${host}`;
        const redirectUri = `${baseUrl}/api/auth/meli/callback`;

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

        // 3. Guardar tokens en la base de datos
        const { error: tokenError } = await supabaseAdmin
            .from('marketplace_tokens')
            .upsert({
                marketplace_id: marketplaceId,
                access_token: access_token,
                refresh_token: refresh_token,
                expires_at: new Date(Date.now() + expires_in * 1000).toISOString()
            });

        if (tokenError) throw tokenError;

        // Redirigir de vuelta a settings con éxito
        return NextResponse.redirect(`${baseUrl}/settings?auth=success`);

    } catch (error: any) {
        console.error('Error en MeLi Callback:', error.response?.data || error.message);
        const host = request.headers.get('host');
        const protocol = host?.includes('localhost') ? 'http' : 'https';
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `${protocol}://${host}`;
        return NextResponse.redirect(`${baseUrl}/settings?auth=error`);
    }
}
