import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const clientId = "1828520903959176";
    const redirectUri = "https://autofichaje2026-dashboard-1img.vercel.app/api/meli/callback";

    // Enviamos a autorizar al usuario. El estado ya no es obligatorio pre-existente.
    const authUrl = `https://auth.mercadolibre.com.mx/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}`;

    console.log('Redirecting to MeLi with ClientID:', clientId);
    return NextResponse.redirect(authUrl);
}
