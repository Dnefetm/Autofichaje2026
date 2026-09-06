import { friendlyError } from '@/lib/friendlyError';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request) {
    try {
        const { importacion_id } = await req.json();

        if (!importacion_id) {
            return NextResponse.json({ error: 'Missing importacion_id' }, { status: 400 });
        }

        const { data, error } = await supabaseAdmin.rpc('fn_revertir_importacion', {
            p_importacion_id: importacion_id
        });

        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (e: any) {
        return NextResponse.json({ error: friendlyError(e) }, { status: 500 });
    }
}
