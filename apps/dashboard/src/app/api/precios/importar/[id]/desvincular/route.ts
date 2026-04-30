import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { clave } = await req.json();
        const { id: importacionId } = await params;

        if (!clave || !importacionId) {
            return NextResponse.json({ ok: false, error: 'Faltan parámetros' }, { status: 400 });
        }

        const [modelo, marca, codigo_universal] = clave.split('||');

        // JS-based perfect matching to avoid PostgREST empty string '.or()' bugs
        const { data: mdData, error: mdFetchErr } = await supabaseAdmin
            .from('matching_decisiones')
            .select('id, modelo_excel, codigo_universal_excel')
            .eq('importacion_id', importacionId)
            .eq('marca_excel', marca);

        if (mdFetchErr) throw new Error(`Fetch MD error: ${mdFetchErr.message}`);

        const mdRow = mdData?.find(r => 
            (modelo ? r.modelo_excel === modelo : (!r.modelo_excel)) &&
            (codigo_universal ? r.codigo_universal_excel === codigo_universal : (!r.codigo_universal_excel))
        );

        if (mdRow) {
            const { error: mdErr } = await supabaseAdmin
                .from('matching_decisiones')
                .update({
                    confirmado: false,
                    articulo_id_final: null,
                    confirmado_por: null,
                    confirmado_en: null
                })
                .eq('id', mdRow.id);
            if (mdErr) throw new Error(`Update MD error: ${mdErr.message}`);
        }

        // 2. Revert costos_articulo
        const { data: caData, error: caFetchErr } = await supabaseAdmin
            .from('costos_articulo')
            .select('id, modelo_excel, codigo_universal_excel')
            .eq('importacion_id', importacionId)
            .eq('marca_excel', marca);

        if (caFetchErr) throw new Error(`Fetch CA error: ${caFetchErr.message}`);

        const caRow = caData?.find(r => 
            (modelo ? r.modelo_excel === modelo : (!r.modelo_excel)) &&
            (codigo_universal ? r.codigo_universal_excel === codigo_universal : (!r.codigo_universal_excel))
        );

        if (caRow) {
            const { error: caErr } = await supabaseAdmin
                .from('costos_articulo')
                .update({
                    articulo_id: null,
                    estado_match: 'sugerido'
                })
                .eq('id', caRow.id);
            if (caErr) throw new Error(`Update CA error: ${caErr.message}`);
        }

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
