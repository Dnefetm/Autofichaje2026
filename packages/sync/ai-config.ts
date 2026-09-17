/**
 * Configuración del proveedor de IA para el publicador.
 *
 * Por defecto usa OpenAI (gpt-4o) para consumir el crédito de OpenAI.
 * Para migrar a DeepSeek sin tocar código, en Vercel pon:
 *   AI_PROVIDER=deepseek
 *   DEEPSEEK_API_KEY=<tu key de DeepSeek>
 *
 * Con AI_PROVIDER=deepseek se auto-configuran baseURL (https://api.deepseek.com)
 * y modelo (deepseek-chat). El modelo se puede pisar con OPENAI_MODEL.
 */

interface AIConfig {
    baseURL?: string;
    model: string;
    apiKey: string | undefined;
}

export function getAIConfig(): AIConfig {
    const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase();

    if (provider === 'deepseek') {
        return {
            baseURL: 'https://api.deepseek.com',
            model: process.env.OPENAI_MODEL || 'deepseek-chat',
            apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
        };
    }

    // OpenAI (default)
    return {
        baseURL: process.env.OPENAI_BASE_URL || undefined,
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        apiKey: process.env.OPENAI_API_KEY,
    };
}
