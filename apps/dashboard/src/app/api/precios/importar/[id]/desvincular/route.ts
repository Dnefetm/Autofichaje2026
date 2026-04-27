import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@gestor/lib/supabase-admin';

export async function POST(req: Request, { params }: { params: { id: string } }) {
    try {
        const { clave } = await req.json();
        const importacionId = params.id;

        if (!clave || !importacionId) {
            return NextResponse.json({ ok: false, error: 'Faltan parámetros' }, { status: 400 });
        }

        const [modelo, marca, codigo_universal] = clave.split('||');

        // 1. Revert matching_decisiones
        let mdQuery = supabaseAdmin
            .from('matching_decisiones')
            .update({
                confirmado: false,
                articulo_id_final: null,
                confirmado_por: null,
                confirmado_en: null
            })
            .eq('importacion_id', importacionId)
            .eq('marca_excel', marca);

        if (modelo) mdQuery = mdQuery.eq('modelo_excel', modelo);
        else mdQuery = mdQuery.is('modelo_excel', null);

        if (codigo_universal) mdQuery = mdQuery.eq('codigo_universal_excel', codigo_universal);
        else mdQuery = mdQuery.is('codigo_universal_excel', null);

        const { error: errorMd } = await mdQuery;
        if (errorMd) throw new Error(`Error en matching_decisiones: ${errorMd.message}`);

        // 2. Revert costos_articulo
        let caQuery = supabaseAdmin
            .from('costos_articulo')
            .update({
                articulo_id: null,
                estado_match: 'sugerido' // Or sin_match based on if there's a sugerido
            })
            .eq('importacion_id', importacionId)
            .eq('marca_excel', marca);

        if (modelo) caQuery = caQuery.eq('modelo_excel', modelo);
        else caQuery = caQuery.is('modelo_excel', null);

        if (codigo_universal) caQuery = caQuery.eq('codigo_universal_excel', codigo_universal);
        else caQuery = caQuery.is('codigo_universal_excel', null);

        const { error: errorCa } = await caQuery;
        if (errorCa) throw new Error(`Error en costos_articulo: ${errorCa.message}`);

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
