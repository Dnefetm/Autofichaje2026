import { encrypt, decrypt } from './crypto';
import axios from 'axios';

/**
 * Obtiene un access_token válido para una cuenta de MeLi.
 * Si el token actual está expirado, lo refresca automáticamente usando env vars centralizadas.
 * Usa lock optimista para evitar race conditions en concurrencia.
 * 
 * @param accountId - ID de marketplace_configs
 * @param supabaseAdmin - Cliente Supabase con Service Role Key
 * @returns access_token descifrado y válido, listo para usar en headers
 */
export async function getValidAccessToken(
    accountId: string,
    supabaseAdmin: any
): Promise<string> {
    // 1. Leer tokens actuales
    const { data: tokenRow, error: tokenError } = await supabaseAdmin
        .from('marketplace_tokens')
        .select('access_token, refresh_token, expires_at')
        .eq('marketplace_id', accountId)
        .single();

    if (tokenError || !tokenRow) {
        throw new Error('Cuenta no vinculada o sin tokens en la base de datos. Re-autoriza en /settings.');
    }

    const expiresAt = new Date(tokenRow.expires_at).getTime();
    const MARGIN_MS = 5 * 60 * 1000; // 5 minutos de margen de seguridad

    // 2. Si el token aún es válido, devolverlo descifrado
    if (Date.now() < expiresAt - MARGIN_MS) {
        return decrypt(tokenRow.access_token);
    }

    // 3. Token expirado → refrescar usando credenciales centralizadas de la APP
    const client_id = process.env.MELI_CLIENT_ID;
    const client_secret = process.env.MELI_CLIENT_SECRET;
    if (!client_id || !client_secret) {
        throw new Error('MELI_CLIENT_ID o MELI_CLIENT_SECRET no configurados en env vars.');
    }

    const currentRefreshToken = decrypt(tokenRow.refresh_token);

    let freshTokens;
    try {
        const response = await axios.post('https://api.mercadolibre.com/oauth/token', null, {
            params: {
                grant_type: 'refresh_token',
                client_id,
                client_secret,
                refresh_token: currentRefreshToken,
            },
        });
        freshTokens = response.data;
    } catch (err: any) {
        const meliError = err.response?.data?.error;
        if (meliError === 'invalid_grant' || err.response?.status === 400) {
            throw new Error(
                'Token de refresh inválido. Re-autorizar cuenta en /settings'
            );
        }
        throw new Error(`Error al refrescar token de MeLi: ${err.response?.data?.message || err.message}`);
    }

    const { access_token, refresh_token: newRefreshToken, expires_in } = freshTokens;
    const newExpiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

    // 4. Lock optimista: solo actualizar si expires_at no cambió
    await supabaseAdmin
        .from('marketplace_tokens')
        .update({
            access_token: encrypt(access_token),
            refresh_token: encrypt(newRefreshToken),
            expires_at: newExpiresAt,
        })
        .eq('marketplace_id', accountId)
        .eq('expires_at', tokenRow.expires_at);

    // Devolvemos el access_token sin cifrar (directo de la respuesta de MeLi)
    return access_token;
}
