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
        // 1. Obtener credenciales de la APP desde env vars (centralizadas)
        const client_id = process.env.MELI_CLIENT_ID;
        const client_secret = process.env.MELI_CLIENT_SECRET;
        if (!client_id || !client_secret) {
            throw new Error('Faltan MELI_CLIENT_ID o MELI_CLIENT_SECRET en env vars');
        }

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

        const { access_token, refresh_token, expires_in, user_id: meliUserId } = response.data;
        const { encrypt } = await import('@gestor/shared/lib/crypto');

        // Auto-guardar seller_id en marketplace_configs.settings
        if (meliUserId) {
            const { data: currentConfig } = await supabaseAdmin
                .from('marketplace_configs')
                .select('settings')
                .eq('id', marketplaceId)
                .single();

            const updatedSettings = {
                ...(currentConfig?.settings || {}),
                seller_id: String(meliUserId)
            };

            await supabaseAdmin
                .from('marketplace_configs')
                .update({ settings: updatedSettings })
                .eq('id', marketplaceId);
        }

        // 3. Guardar tokens en la base de datos (Encriptados)
        const { error: tokenError } = await supabaseAdmin
            .from('marketplace_tokens')
            .upsert({
                marketplace_id: marketplaceId,
                access_token: encrypt(access_token),
                refresh_token: encrypt(refresh_token),
                expires_at: new Date(Date.now() + expires_in * 1000).toISOString()
            });

        if (tokenError) throw tokenError;

        // --- MITIGACIÓN: Despacho automático del Worker al vincular cuenta ---
        await supabaseAdmin.from('jobs').insert({
            type: 'sync_account_catalog',
            payload: {
                marketplace_id: marketplaceId
            },
            status: 'pending',
            scheduled_at: new Date().toISOString()
        });
        console.log(`[Cloud] Worker despachado para forzar sincronización del Catálogo Virtual (Vitrinas) con ID: ${marketplaceId}`);
        // ---------------------------------------------------------------------

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
