import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Búsqueda de artículos existentes en catálogo antes de guardar una ficha
// Criterios en orden de prioridad: SKU exacto → EAN → modelo → nombre ILIKE

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export interface ArticuloMatch {
    articulo_id: string;
    nombre: string;
    marca: string;
    modelo?: string;
    categoria?: string;
    descripcion?: string;
    codigo_universal?: string;
    codigo_sat?: string;
    score: 'exact' | 'ean' | 'model' | 'name'; // nivel de certeza del match
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);

    const sku    = searchParams.get('sku')    || '';
    const ean    = searchParams.get('ean')    || '';
    const modelo = searchParams.get('modelo') || '';
    const nombre = searchParams.get('nombre') || '';

    const SELECT = 'articulo_id, nombre, marca, modelo, categoria, descripcion, codigo_universal, codigo_sat';

    try {
        // 1. Búsqueda exacta por SKU (articulo_id)
        if (sku) {
            const { data } = await supabase
                .from('articulos')
                .select(SELECT)
                .eq('articulo_id', sku)
                .limit(1);
            if (data?.length) {
                return NextResponse.json({ matches: data.map(r => ({ ...r, score: 'exact' })) });
            }
        }

        // 2. Búsqueda por EAN / código universal
        if (ean) {
            const { data } = await supabase
                .from('articulos')
                .select(SELECT)
                .eq('codigo_universal', ean)
                .limit(5);
            if (data?.length) {
                return NextResponse.json({ matches: data.map(r => ({ ...r, score: 'ean' })) });
            }
        }

        // 3. Búsqueda por modelo
        if (modelo) {
            const { data } = await supabase
                .from('articulos')
                .select(SELECT)
                .ilike('modelo', `%${modelo}%`)
                .limit(5);
            if (data?.length) {
                return NextResponse.json({ matches: data.map(r => ({ ...r, score: 'model' })) });
            }
        }

        // 4. Búsqueda por nombre (más amplia — limitar a 8 resultados)
        if (nombre && nombre.length >= 4) {
            // Usar las primeras 3 palabras significativas para reducir falsos positivos
            const words = nombre.split(/\s+/).filter(w => w.length > 2).slice(0, 3);
            if (words.length > 0) {
                const pattern = words.join('%');
                const { data } = await supabase
                    .from('articulos')
                    .select(SELECT)
                    .ilike('nombre', `%${pattern}%`)
                    .limit(8);
                if (data?.length) {
                    return NextResponse.json({ matches: data.map(r => ({ ...r, score: 'name' })) });
                }
            }
        }

        // Sin resultados
        return NextResponse.json({ matches: [] });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
