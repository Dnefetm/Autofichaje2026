import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
    try {
        const { proveedor, articulo_id, accion } = await req.json();

        if (!proveedor || !articulo_id || !accion) {
            return NextResponse.json({ error: 'Faltan parámetros requeridos' }, { status: 400 });
        }

        if (accion !== 'confirmado_vigente' && accion !== 'marcado_descontinuado') {
            return NextResponse.json({ error: 'Acción no válida' }, { status: 400 });
        }

        const { error } = await supabaseAdmin
            .from('precio_revisiones_manuales')
            .insert({
                proveedor,
                articulo_id,
                accion,
                usuario: 'sistema' // TODO: replace with auth user
            });

        if (error) {
            console.error('Error insertando revision manual:', error);
            throw error;
        }

        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Error interno del servidor' }, { status: 500 });
    }
}
