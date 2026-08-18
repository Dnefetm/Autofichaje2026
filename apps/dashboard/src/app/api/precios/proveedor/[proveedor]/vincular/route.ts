import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(
    req: NextRequest,
    props: { params: Promise<{ proveedor: string }> }
) {
    try {
        const { proveedor: provParam } = await props.params;
        const proveedor = decodeURIComponent(provParam);
        const body = await req.json();
        const { articulo_id, codigo_excel, marca_excel, modelo_excel, tipo_costo, valor, moneda, incluye_iva, importacion_id } = body;

        if (!articulo_id) {
            return NextResponse.json({ ok: false, error: 'Se requiere articulo_id' }, { status: 400 });
        }

        // 1. Guardar o actualizar en proveedor_articulos_alias (persistente de por vida)
        const { data: existingAlias } = await supabaseAdmin
            .from('proveedor_articulos_alias')
            .select('id')
            .eq('proveedor', proveedor)
            .eq('codigo_excel', codigo_excel || '')
            .limit(1)
            .maybeSingle();

        let aliasErr;
        if (existingAlias) {
            const { error: updErr } = await supabaseAdmin
                .from('proveedor_articulos_alias')
                .update({
                    articulo_id,
                    marca_excel: marca_excel || '',
                    modelo_excel: modelo_excel || '',
                    estado_proveedor: 'activo',
                    ultima_vez_visto: new Date().toISOString()
                })
                .eq('id', existingAlias.id);
            aliasErr = updErr;
        } else {
            const { error: insErr } = await supabaseAdmin
                .from('proveedor_articulos_alias')
                .insert({
                    proveedor,
                    codigo_excel: codigo_excel || '',
                    marca_excel: marca_excel || '',
                    modelo_excel: modelo_excel || '',
                    articulo_id,
                    estado_proveedor: 'activo',
                    ultima_vez_visto: new Date().toISOString()
                });
            aliasErr = insErr;
        }

        if (aliasErr) {
            return NextResponse.json({ ok: false, error: `Error guardando alias: ${aliasErr.message}` }, { status: 500 });
        }

        // 2. Si se proporcionó valor de costo, insertar o actualizar directamente en costos_articulo
        if (valor !== undefined && valor !== null) {
            const { error: costoErr } = await supabaseAdmin
                .from('costos_articulo')
                .upsert({
                    articulo_id,
                    tipo_costo: (tipo_costo || 'distribuidor').toLowerCase(),
                    valor: parseFloat(valor),
                    moneda: moneda || 'MXN',
                    fuente: 'excel',
                    estado_match: 'match_exacto',
                    puntaje_match: 100,
                    vigente: true,
                    incluye_iva: !!incluye_iva,
                    importacion_id: importacion_id || null,
                    modelo_excel: modelo_excel || '',
                    marca_excel: marca_excel || '',
                    codigo_universal_excel: codigo_excel || '',
                    actualizado_el: new Date().toISOString()
                }, {
                    onConflict: 'articulo_id,tipo_costo,fuente'
                });

            if (costoErr) {
                return NextResponse.json({ ok: false, error: `Error guardando costo: ${costoErr.message}` }, { status: 500 });
            }
        }

        return NextResponse.json({
            ok: true,
            mensaje: 'Artículo vinculado exitosamente y costo sincronizado',
            proveedor,
            articulo_id
        });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
