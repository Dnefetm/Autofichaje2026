import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const marketplaceId = searchParams.get('marketplace_id');

    if (!marketplaceId) {
        return NextResponse.json({ error: 'marketplace_id es requerido' }, { status: 400 });
    }

    const clientId = process.env.MELI_CLIENT_ID;
    if (!clientId) {
        return NextResponse.json({ error: 'MELI_CLIENT_ID no configurado en env vars' }, { status: 500 });
    }

    const host = request.headers.get('host');
    const protocol = host?.includes('localhost') ? 'http' : 'https';
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `${protocol}://${host}`;
    const redirectUri = `${baseUrl}/api/auth/meli/callback`;

    const authUrl = `https://auth.mercadolibre.com.mx/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${marketplaceId}`;

    return NextResponse.redirect(authUrl);
}
