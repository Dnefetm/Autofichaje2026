import { friendlyError } from '@/lib/friendlyError';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/precios/importar/[id]/marcas-distintas
// Devuelve los valores DISTINTOS de la columna de marca (con conteo), para que
// el operador apruebe cuáles son marcas reales. El resto se reemplaza por la
// marca por defecto en fn_procesar_precios_proveedor.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const { id } = await props.params;

    try {
        const { data: imp } = await supabaseAdmin
            .from('importaciones_excel')
            .select('mapeo_columnas')
            .eq('id', id)
            .single();

        const colMarca = imp?.mapeo_columnas?.columna_marca;
        if (!colMarca) {
            return NextResponse.json({ ok: true, marcas: [], columna_marca: null });
        }

        // Leer filas crudas y deduplicar valores de la columna de marca
        const counts = new Map<string, number>();
        let from = 0;
        while (true) {
            const { data, error } = await supabaseAdmin
                .from('listas_precios_raw')
                .select('payload')
                .eq('importacion_id', id)
                .range(from, from + 999);
            if (error) throw error;
            if (!data || data.length === 0) break;
            for (const r of data) {
                const v = String((r.payload || {})[colMarca] ?? '').trim();
                if (v) counts.set(v, (counts.get(v) || 0) + 1);
            }
            if (data.length < 1000) break;
            from += 1000;
        }

        const marcas = Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([marca, count]) => ({ marca, count }));

        return NextResponse.json({ ok: true, columna_marca: colMarca, marcas });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: friendlyError(e) }, { status: 500 });
    }
}
