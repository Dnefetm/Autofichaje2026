import { NextResponse } from 'next/server';
import axios from 'axios';
import { supabaseAdmin } from '@/lib/supabase';
import { encrypt } from '@gestor/shared/lib/crypto';

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
        // 1. Intercambiar código por tokens
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

        // 2. Obtener identidad del Vendedor (User Me)
        const userRes = await axios.get('https://api.mercadolibre.com/users/me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const sellerId = userRes.data.id;
        const nickname = userRes.data.nickname;

        // 3. Crear o actualizar la configuración de esta Tienda automáticamente
        const { data: config, error: configError } = await supabaseAdmin
            .from('marketplace_configs')
            .upsert({
                marketplace: 'mercadolibre',
                account_name: nickname || `Tienda ${sellerId}`,
                is_active: true,
                settings: { seller_id: sellerId, email: userRes.data.email }
            }, { onConflict: 'marketplace, account_name' })
            .select('id')
            .single();

        if (configError) throw configError;

        const finalMarketplaceId = config.id;

        // 4. Guardar tokens en la base de datos (Encriptados)
        const { error: tokenError } = await supabaseAdmin
            .from('marketplace_tokens')
            .upsert({
                marketplace_id: finalMarketplaceId,
                access_token: encrypt(access_token),
                refresh_token: encrypt(refresh_token),
                expires_at: new Date(Date.now() + expires_in * 1000).toISOString()
            });

        if (tokenError) throw tokenError;

        // 5. Automatización: Encolar sincronización del Catálogo Virtual de inmediato (En la Nube)
        // Esto evita que el usuario tenga que correr scripts manuales en la terminal
        await supabaseAdmin.from('jobs').insert({
            type: 'sync_account_catalog',
            payload: {
                marketplace_id: finalMarketplaceId
            },
            status: 'pending',
            scheduled_at: new Date().toISOString()
        });

        console.log(`[Cloud] Job de Sincronización Masiva Creado para Tienda: ${finalMarketplaceId}`);

        return NextResponse.redirect(`${baseUrl}/settings?auth=success`);

    } catch (error: any) {
        console.error('Error en MeLi Callback:', error.response?.data || error.message);
        return NextResponse.redirect(`${baseUrl}/settings?auth=error&msg=${encodeURIComponent(error.message)}`);
    }
}
