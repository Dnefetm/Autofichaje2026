import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await props.params;
        const url = new URL(req.url);
        
        const page = parseInt(url.searchParams.get('page') || '1', 10);
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        const nivel = url.searchParams.get('nivel');
        const query = url.searchParams.get('q');
        const offset = (page - 1) * limit;

        let dbQuery = supabaseAdmin
            .from('matching_decisiones')
            .select('*', { count: 'exact' })
            .eq('importacion_id', id);

        if (nivel) {
            dbQuery = dbQuery.eq('nivel', parseInt(nivel, 10));
        }

        if (query) {
            // Buscamos en el modelo original o en el candidato propuesto
            dbQuery = dbQuery.or(`modelo_excel.ilike.%${query}%,marca_excel.ilike.%${query}%,cand_modelo.ilike.%${query}%`);
        }

        // Orden principal: preseleccionados primero, luego por porcentaje descendente
        dbQuery = dbQuery
            .order('preseleccionado', { ascending: false })
            .order('pct', { ascending: false })
            .range(offset, offset + limit - 1);

        const { data, count, error } = await dbQuery;

        if (error) {
            console.error("Error al obtener candidatos:", error);
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({
            ok: true,
            data,
            meta: {
                total: count || 0,
                page,
                limit,
                totalPages: Math.ceil((count || 0) / limit)
            }
        });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await props.params;
        const body = await req.json();

        // Esperamos un arreglo de actualizaciones: { id: string, articulo_id_final: string | null, confirmado: boolean }
        const { updates } = body;

        if (!Array.isArray(updates) || updates.length === 0) {
            return NextResponse.json({ ok: false, error: 'No se enviaron datos para actualizar' }, { status: 400 });
        }

        // Ya que Supabase Data API no soporta "bulk update" nativo de forma sencilla (solo si el primary key está en match y upsert)
        // Haremos un upsert usando la clave primaria 'id'
        const upsertData = updates.map((u: any) => ({
            id: u.id,
            importacion_id: id,
            articulo_id_final: u.articulo_id_final,
            confirmado: u.confirmado,
            editado_el: new Date().toISOString()
        }));

        const { data, error } = await supabaseAdmin
            .from('matching_decisiones')
            .upsert(upsertData, { onConflict: 'id', ignoreDuplicates: false })
            .select('id, articulo_id_final, confirmado');

        if (error) {
            console.error("Error al actualizar candidatos:", error);
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true, data });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
