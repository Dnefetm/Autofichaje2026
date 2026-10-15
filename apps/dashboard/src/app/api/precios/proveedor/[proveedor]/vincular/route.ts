import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { friendlyError } from '@/lib/friendlyError';

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

        // 1. Guardar o actualizar en proveedor_articulos_alias (persistente de por vida).
        //    NORMALIZADO y a prueba de duplicados: el indice unico ux_alias_codigo indexa el
        //    valor CRUDO del campo, asi que un espacio o distinto case hacia que la busqueda
        //    exacta no encontrara la fila, se intentara INSERT y rebotara con 23505
        //    ("Ese registro ya existe").
        const codigoNorm = (codigo_excel ?? '').trim();
        const marcaNorm  = (marca_excel  ?? '').trim();
        const modeloNorm = (modelo_excel ?? '').trim();
        const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();
        const escLike = (s: string) => s.replace(/[%_\\]/g, '\\$&');

        let candidatosAlias: Array<{ id: string; codigo_excel: string | null; marca_excel: string | null; modelo_excel: string | null }> = [];
        if (codigoNorm) {
            const { data } = await supabaseAdmin
                .from('proveedor_articulos_alias')
                .select('id, codigo_excel, marca_excel, modelo_excel')
                .eq('proveedor', proveedor)
                .ilike('codigo_excel', `%${escLike(codigoNorm)}%`)
                .limit(20);
            candidatosAlias = data ?? [];
        } else {
            const { data } = await supabaseAdmin
                .from('proveedor_articulos_alias')
                .select('id, codigo_excel, marca_excel, modelo_excel')
                .eq('proveedor', proveedor)
                .eq('marca_excel', marcaNorm)
                .eq('modelo_excel', modeloNorm)
                .limit(20);
            candidatosAlias = data ?? [];
        }

        const existingAlias = (codigoNorm
            ? candidatosAlias.find(a => norm(a.codigo_excel) === norm(codigoNorm))
            : candidatosAlias.find(a => !norm(a.codigo_excel) && norm(a.marca_excel) === norm(marcaNorm) && norm(a.modelo_excel) === norm(modeloNorm))
        ) ?? null;

        const aliasPayload = {
            proveedor,
            codigo_excel: codigoNorm,
            marca_excel: marcaNorm,
            modelo_excel: modeloNorm,
            articulo_id,
            estado_proveedor: 'activo',
            // locked = true: es un vinculo HUMANO explicito. El endpoint de desvincular
            // usaba este flag para decidir si borraba; ahora borra siempre, pero se marca
            // igual para que la intencion quede registrada en la fila.
            locked: true,
            ultima_vez_visto: new Date().toISOString()
        };

        let aliasErr: any = null;
        if (existingAlias) {
            const { error: updErr } = await supabaseAdmin
                .from('proveedor_articulos_alias')
                .update(aliasPayload)
                .eq('id', existingAlias.id);
            aliasErr = updErr;
        } else {
            const { error: insErr } = await supabaseAdmin
                .from('proveedor_articulos_alias')
                .insert(aliasPayload);

            if (insErr) {
                // 23505: la fila ya existe con otro formato (espacios o distinto case).
                // Se reintenta como UPDATE sobre el candidato normalizado.
                const dup = candidatosAlias.find(a => norm(a.codigo_excel) === norm(codigoNorm))
                         ?? candidatosAlias.find(a => norm(a.marca_excel) === norm(marcaNorm) && norm(a.modelo_excel) === norm(modeloNorm));
                if (dup) {
                    const { error: retryErr } = await supabaseAdmin
                        .from('proveedor_articulos_alias')
                        .update(aliasPayload)
                        .eq('id', dup.id);
                    aliasErr = retryErr;
                } else {
                    aliasErr = insErr;
                }
            }
        }

        if (aliasErr) {
            return NextResponse.json({ ok: false, error: friendlyError(aliasErr) }, { status: 500 });
        }

        // 2. Si se proporcionó valor de costo, insertar o actualizar directamente en costos_articulo (legacy)
        if (valor !== undefined && valor !== null) {
            try {
                // RETIRADO: aqui habia un UPDATE que ponia vigente = false filtrando SOLO
                // por codigo de barras, es decir apagaba los costos vigentes de OTRO
                // articulo que comparte el codigo. Era la maniobra necesaria para "hacer
                // espacio" al escribir: el origen de los costos que desaparecian y del
                // choque de unicidad. Asignar un vinculo NO debe tocar a terceros.

                const { error: costoErr } = await supabaseAdmin
                    .from('costos_articulo')
                    .upsert({
                        articulo_id,
                        tipo_costo: (tipo_costo || 'menudeo').toLowerCase(),
                        valor: parseFloat(valor),
                        moneda: moneda || 'MXN',
                        fuente: 'excel',
                        estado_match: 'vinculacion_manual',
                        puntaje_match: null,
                        vigente: true,
                        incluye_iva: !!incluye_iva,
                        importacion_id: importacion_id || null,
                        modelo_excel: modeloNorm,
                        marca_excel: marcaNorm,
                        codigo_universal_excel: codigoNorm,
                        actualizado_el: new Date().toISOString()
                    }, {
                        onConflict: 'articulo_id,tipo_costo,fuente'
                    });

                if (costoErr) {
                    console.warn('[vincular] Advertencia al escribir en costos_articulo (legacy):', costoErr.message);
                }
            } catch (legacyErr) {
                console.warn('[vincular] Excepción en costos_articulo (legacy):', legacyErr);
            }
        }

        return NextResponse.json({
            ok: true,
            mensaje: 'Artículo vinculado exitosamente y costo sincronizado',
            proveedor,
            articulo_id
        });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: friendlyError(err) }, { status: 500 });
    }
}
