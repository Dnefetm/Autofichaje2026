import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const headerList = headers();
        const token = headerList.get('authorization')?.split('Bearer ')[1];
        if (!token) {
            return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });
        }
        
        const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
        if (userErr || !user) {
            return NextResponse.json({ ok: false, error: 'Usuario inválido' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const proveedor_id = searchParams.get('proveedor_id');
        const marca = searchParams.get('marca');
        const modelo = searchParams.get('modelo');
        const limit = Number(searchParams.get('limit') || '50');

        if (!proveedor_id) {
            return NextResponse.json({ ok: false, error: 'proveedor_id es requerido' }, { status: 400 });
        }

        let query = supabaseAdmin
            .from('listas_precios_raw')
            .select('*')
            .eq('proveedor_id', proveedor_id)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (marca) {
            // Nota: Aquí dependemos de que exista el key en el JSON. 
            // Las sentencias de JSON path filter pueden variar, pero GIN ayudará.
            // Para simplicidad cruzamos con texto, o usando el operador @> si construimos el objeto,
            // pero si la key es dinámica, jsonb path filtering es necesario, p.ej. payload->>'MARCA' ilike %marca% 
            // no es directamente soportado en Supabase js client methods simples para ILIKE.
            // Asi que lo parseamos usando textSearch o raw. Supabase soporta filtros en JSON keys.
            // Si el nombre de la columna era distinto a 'MARCA', dependeremos de un full text search o del match exacto.
            
            // Usando postgrest syntax: `payload->>MARCA.ilike.%xxx%` (asume que la key se llama MARCA)
            // Ya que los headers pueden ser diferentes (ej: 'Marca', 'MARCA', 'brand'), es mejor 
            // simplemente buscar texto en cualquier parte del objeto payload como truco rápido de GIN, o
            // usar el método or().
        }
        
        // Ejecutamos query con filtrados textuales en json si se proveen
        let { data: filas, error: fetchErr } = await query;

        if (fetchErr) {
            return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
        }

        // Ya que las llaves JSON son dinámicas (headers del excel), filtrar vía Supabase JS es frágil si no
        // sabemos exacto el case de la key. Si mandaron "marca", filtramos in-memory si son pocos o
        // reconstruimos un raw query si fueran muchos. Al estar limitados a 50~ no es problema hacerlo in-memory
        // como fallback, o simplemente aplicar el filtro JSONB si se conoce la estructura exacta.
        if (filas && (marca || modelo)) {
            filas = filas.filter(f => {
                let match = true;
                const payloadStr = JSON.stringify(f.payload || {}).toLowerCase();
                if (marca) match = match && payloadStr.includes(marca.toLowerCase());
                if (modelo) match = match && payloadStr.includes(modelo.toLowerCase());
                return match;
            });
        }

        return NextResponse.json({ ok: true, filas });

    } catch (error: any) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
