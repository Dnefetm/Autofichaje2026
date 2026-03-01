import { supabase } from '@gestor/shared/lib/supabase';
import logger from '@gestor/shared/lib/logger';
import axios from 'axios';

export class MeliTokenManager {
    private static MELI_API_URL = 'https://api.mercadolibre.com/oauth/token';

    /**
     * Verifica y renueva tokens que están por expirar (ej: en los próximos 10 minutos)
     */
    static async refreshExpiringTokens() {
        logger.info('Verificando tokens de Mercado Libre por vencer...');

        const bufferTime = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos de margen

        const { data: tokens, error } = await supabase
            .from('marketplace_tokens')
            .select('*, marketplace_configs!inner(marketplace)')
            .eq('marketplace_configs.marketplace', 'meli')
            .lt('expires_at', bufferTime.toISOString());

        if (error) {
            logger.error({ error }, 'Error al consultar tokens por vencer en Supabase');
            return;
        }

        if (!tokens || tokens.length === 0) {
            logger.info('No hay tokens de MeLi por renovar en este momento.');
            return;
        }

        for (const token of tokens) {
            await this.performRefresh(token);
        }
    }

    private static async performRefresh(tokenData: any) {
        const { marketplace_id, refresh_token } = tokenData;

        // Aquí necesitaríamos el client_id y client_secret de la cuenta
        // Estos deberían estar en marketplace_configs.settings
        const { data: config } = await supabase
            .from('marketplace_configs')
            .select('settings')
            .eq('id', marketplace_id)
            .single();

        if (!config?.settings?.client_id || !config?.settings?.client_secret) {
            logger.error({ marketplace_id }, 'Faltan credenciales client_id/secret para renovar token');
            return;
        }

        try {
            logger.info({ marketplace_id }, 'Renovando token de Mercado Libre...');

            const params = new URLSearchParams();
            params.append('grant_type', 'refresh_token');
            params.append('client_id', config.settings.client_id);
            params.append('client_secret', config.settings.client_secret);
            params.append('refresh_token', refresh_token);

            const response = await axios.post(this.MELI_API_URL, params);

            const { access_token, refresh_token: new_refresh_token, expires_in } = response.data;

            await supabase.from('marketplace_tokens').upsert({
                marketplace_id,
                access_token,
                refresh_token: new_refresh_token,
                expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
                updated_at: new Date().toISOString()
            });

            logger.info({ marketplace_id }, 'Token de Mercado Libre renovado con éxito');
        } catch (err: any) {
            logger.error({
                marketplace_id,
                error: err.response?.data || err.message
            }, 'Error crítico al renovar token de Mercado Libre');

            // Aquí se podrían activar alertas vía Slack/Email
        }
    }
}
