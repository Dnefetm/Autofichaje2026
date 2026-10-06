import { NextResponse } from 'next/server';
import axios from 'axios';
import { supabaseAdmin } from '@/lib/supabase';
import { dispatchWorker } from '@/lib/dispatch-worker';

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

        // 2.5. Identidad real del vendedor (vía /users/me): seller_id + nickname.
        let meliUserIdFinal: any = meliUserId;
        let meliNickname: string | null = null;
        try {
            const meResp = await axios.get('https://api.mercadolibre.com/users/me', {
                headers: { Authorization: `Bearer ${access_token}` }
            });
            if (meResp.data?.id) meliUserIdFinal = meResp.data.id;
            meliNickname = meResp.data?.nickname ?? null;
        } catch (e: any) {
            console.warn(`[OAuth Callback] /users/me fallo (uso user_id del token):`, e?.message);
        }

        const sellerTxt = String(meliUserIdFinal);

        // 2.6. GUARD: un vendedor solo puede estar vinculado a UNA cuenta activa.
        const { data: duplicado } = await supabaseAdmin
            .from('marketplace_configs')
            .select('id, account_name')
            .eq('is_active', true)
            .neq('id', marketplaceId)
            .eq('settings->>seller_id', sellerTxt)
            .maybeSingle();

        if (duplicado) {
            console.warn(`[OAuth Callback] BLOQUEADO: seller ${sellerTxt} ya vinculado a ${duplicado.account_name}`);
            return NextResponse.redirect(
                `${baseUrl}/settings?auth=error&reason=duplicate_seller&seller=${encodeURIComponent(sellerTxt)}&cuenta=${encodeURIComponent(duplicado.account_name)}`
            );
        }

        // Guardar identidad real en settings (seller_id + nickname) para que la UI la muestre.
        if (meliUserIdFinal) {
            const { data: currentConfig } = await supabaseAdmin
                .from('marketplace_configs')
                .select('settings')
                .eq('id', marketplaceId)
                .single();

            const updatedSettings = {
                ...(currentConfig?.settings || {}),
                seller_id: sellerTxt,
                ...(meliNickname ? { seller_nickname: meliNickname } : {}),
            };

            await supabaseAdmin
                .from('marketplace_configs')
                .update({ settings: updatedSettings })
                .eq('id', marketplaceId);

            console.log(`[OAuth Callback] seller_id ${sellerTxt} (${meliNickname ?? 'sin nickname'}) guardado en ${marketplaceId}`);
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
                await dispatchWorker(); // V31: trigger worker on-demand
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
