import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET: Obtiene la configuración de MeLi
export async function GET() {
    try {
        const { data, error } = await supabaseAdmin
            .from('marketplace_configs')
            .select('*')
            .in('marketplace', ['meli', 'mercadolibre'])
            .limit(1)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 es "no rows found", que es válido para la primera vez
            throw error;
        }

        return NextResponse.json(data || {});
    } catch (error: any) {
        console.error('Error fetching MeLi settings:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// POST: Guarda o actualiza la configuración de MeLi
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { account_name, client_id, client_secret, is_active } = body;

        const { data, error } = await supabaseAdmin
            .from('marketplace_configs')
            .upsert({
                account_name: account_name || 'Mi Tienda Principal',
                marketplace: 'mercadolibre', // Estandarizamos
                is_active: is_active ?? true,
                settings: {
                    client_id,
                    client_secret
                }
            }, { onConflict: 'marketplace' })
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json(data);
    } catch (error: any) {
        console.error('Error saving MeLi settings:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
