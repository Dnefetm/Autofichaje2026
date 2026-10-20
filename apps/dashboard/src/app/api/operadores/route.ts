import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/operadores — lista de operadores activos para el selector del formulario.
// Solo id + nombre (id es text, FK de egresos.operador_id). Se cachea en el cliente.
export async function GET() {
    const { data, error } = await supabaseAdmin
        .from('operadores')
        .select('id, nombre')
        .eq('estatus', 'Activo')
        .order('nombre');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ operadores: data ?? [] });
}
