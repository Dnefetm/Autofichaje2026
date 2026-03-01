import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const marketplaceId = searchParams.get('marketplace_id');

    if (!marketplaceId) {
        return NextResponse.json({ error: 'Falta marketplace_id' }, { status: 400 });
    }

    const { data: config } = await supabaseAdmin
        .from('marketplace_configs')
        .select('settings')
        .eq('id', marketplaceId)
        .single();

    if (!config || !config.settings?.client_id) {
        return NextResponse.json({ error: 'Configuración de MeLi no encontrada o incompleta' }, { status: 404 });
    }

    const clientId = config.settings.client_id;
    const host = request.headers.get('host');
    const protocol = host?.includes('localhost') ? 'http' : 'https';
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `${protocol}://${host}`;
    const redirectUri = `${baseUrl}/api/auth/meli/callback`;

    const authUrl = `https://auth.mercadolibre.com.mx/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${marketplaceId}`;

    return NextResponse.redirect(authUrl);
}
