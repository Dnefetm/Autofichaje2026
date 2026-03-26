import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Búsqueda de artículos en catálogo para vinculación manual por el operador.
// Devuelve TODOS los matches de todos los niveles con score numérico.
// No hace early-return — el operador elige el artículo correcto.

export interface ArticuloMatch {
    articulo_id:      string;
    nombre:           string;
    marca:            string;
    modelo?:          string;
    categoria?:       string;
    descripcion?:     string;
    codigo_universal?: string;
    codigo_sat?:      string;
    score_label: 'exact' | 'ean' | 'model' | 'name'; // nivel de certeza
    score:       number;  // numérico: 100=exacto, 80=ean, 60=modelo, 30=nombre
}

const SELECT = 'articulo_id, nombre, marca, modelo, categoria, descripcion, codigo_universal, codigo_sat';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const sku    = searchParams.get('sku')    || '';
    const ean    = searchParams.get('ean')    || '';
    const modelo = searchParams.get('modelo') || '';
    const nombre = searchParams.get('nombre') || '';
    // Búsqueda manual libre (puede ser SKU, EAN, nombre o modelo simultáneamente)
    const q      = searchParams.get('q')      || '';

    try {
        const seenIds = new Set<string>();
        const matches: ArticuloMatch[] = [];

        const add = (rows: any[], label: ArticuloMatch['score_label'], score: number) => {
            for (const r of rows ?? []) {
                if (!seenIds.has(r.articulo_id)) {
                    seenIds.add(r.articulo_id);
                    matches.push({ ...r, score_label: label, score });
                }
            }
        };

        // ── Búsqueda automática (desde IA): todos los niveles, sin early-return ──

        if (sku) {
            const { data } = await supabase.from('articulos').select(SELECT).eq('articulo_id', sku).limit(1);
            add(data ?? [], 'exact', 100);
        }

        if (ean) {
            const { data } = await supabase.from('articulos').select(SELECT).eq('codigo_universal', ean).limit(5);
            add(data ?? [], 'ean', 80);
        }

        if (modelo && modelo.length >= 2) {
            const { data } = await supabase.from('articulos').select(SELECT).ilike('modelo', `%${modelo}%`).limit(5);
            add(data ?? [], 'model', 60);
        }

        // Búsqueda por nombre: mínimo 5 chars, al menos 2 palabras significativas para reducir falsos positivos
        if (nombre && nombre.length >= 5) {
            const words = nombre.split(/\s+/).filter(w => w.length > 3).slice(0, 3);
            if (words.length >= 1) {
                const pattern = words.join('%');
                const { data } = await supabase.from('articulos').select(SELECT).ilike('nombre', `%${pattern}%`).limit(8);
                add(data ?? [], 'name', 30);
            }
        }

        // ── Búsqueda manual libre (campo q del operador) ──────────────────────
        if (q && q.length >= 2) {
            // Busca en articulo_id (SKU), codigo_universal (EAN) y nombre simultáneamente
            const [byId, byEan, byNombre] = await Promise.all([
                supabase.from('articulos').select(SELECT).ilike('articulo_id', `%${q}%`).limit(5),
                supabase.from('articulos').select(SELECT).eq('codigo_universal', q).limit(3),
                supabase.from('articulos').select(SELECT).ilike('nombre', `%${q}%`).limit(8),
            ]);

            // Score del match manual según qué campo coincidió
            add(byEan.data  ?? [], 'ean',   80);
            add(byId.data   ?? [], 'exact', 70); // ILIKE en ID = no exacto, pero muy probable
            add(byNombre.data ?? [], 'name', 30);
        }

        // Ordenar por score descendente
        matches.sort((a, b) => b.score - a.score);

        return NextResponse.json({ matches });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
