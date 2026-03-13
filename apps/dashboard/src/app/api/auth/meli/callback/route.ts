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

        console.log(`[OAuth Callback] Token exchange OK for marketplace ${marketplaceId}. MeLi user_id: ${meliUserId}. expires_in: ${expires_in}s`);

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

            console.log(`[OAuth Callback] seller_id ${meliUserId} saved to marketplace_configs.settings`);
        }

        // 3. Guardar tokens en la DB (Encriptados) — con onConflict explícito
        const tokenData = {
            marketplace_id: marketplaceId,
            access_token: encrypt(access_token),
            refresh_token: encrypt(refresh_token),
            expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
            updated_at: new Date().toISOString()
        };

        const { error: tokenError } = await supabaseAdmin
            .from('marketplace_tokens')
            .upsert(tokenData, { onConflict: 'marketplace_id' });

        if (tokenError) {
            console.error(`[OAuth Callback] ERROR persisting tokens:`, JSON.stringify(tokenError));
            throw tokenError;
        }

        console.log(`[OAuth Callback] Tokens persisted OK for ${marketplaceId}. updated_at: ${tokenData.updated_at}`);

        // --- MITIGACIÓN: Despacho automático del Worker al vincular cuenta ---
        await supabaseAdmin.from('jobs').insert({
            type: 'sync_account_catalog',
            payload: {
                marketplace_id: marketplaceId
            },
            status: 'pending',
            scheduled_at: new Date().toISOString()
        });
        console.log(`[OAuth Callback] Worker despachado para sync catálogo con ID: ${marketplaceId}`);
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
