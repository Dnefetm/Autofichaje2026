import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET: Obtiene TODAS las configuraciones de MeLi
export async function GET() {
    try {
        const { data, error } = await supabaseAdmin
            .from('marketplace_configs')
            .select('*, marketplace_tokens(access_token, updated_at, expires_at)') // Join tokens to visually show if linked
            .in('marketplace', ['meli', 'mercadolibre'])
            .order('created_at', { ascending: true });

        if (error) {
            throw error;
        }

        return NextResponse.json(data || []);
    } catch (error: any) {
        console.error('Error fetching MeLi settings:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// POST: Guarda o actualiza una configuración de MeLi
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { id, account_name, client_id, client_secret, is_active } = body;

        let query;

        if (id) {
            query = supabaseAdmin
                .from('marketplace_configs')
                .update({
                    account_name: account_name || 'Tienda',
                    is_active: is_active ?? true,
                    settings: {
                        client_id,
                        client_secret
                    }
                })
                .eq('id', id);
        } else {
            query = supabaseAdmin
                .from('marketplace_configs')
                .insert({
                    account_name: account_name || 'Nueva Tienda MeLi',
                    marketplace: 'mercadolibre', // Estandarizamos
                    is_active: is_active ?? true,
                    settings: {
                        client_id,
                        client_secret
                    }
                });
        }

        const { data, error } = await query.select().single();

        if (error) throw error;

        return NextResponse.json(data);
    } catch (error: any) {
        console.error('Error saving MeLi settings:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
