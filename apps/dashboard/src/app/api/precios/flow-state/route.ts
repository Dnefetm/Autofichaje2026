import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const proveedor = searchParams.get('proveedor');

    if (!proveedor) {
        return NextResponse.json({ error: 'Missing proveedor' }, { status: 400 });
    }

    try {
        const { data: activeLpp } = await supabaseAdmin
            .from('listas_precios_proveedor')
            .select('importacion_id')
            .eq('proveedor', proveedor)
            .eq('vigente', true)
            .limit(1);

        let ultimaImportacion = null;
        if (activeLpp && activeLpp[0]) {
            const { data: ultimas } = await supabaseAdmin
                .from('v_importaciones_historial')
                .select('*')
                .eq('id', activeLpp[0].importacion_id);
            ultimaImportacion = ultimas?.[0] || null;
        } else {
            const { data: ultimas } = await supabaseAdmin
                .from('v_importaciones_historial')
                .select('*')
                .eq('proveedor', proveedor)
                .order('creado_el', { ascending: false })
                .limit(1);
            ultimaImportacion = ultimas?.[0] || null;
        }

        let diffPendienteCount = 0;
        let diffMatchCount = 0;
        let loteNum = 1;

        if (ultimaImportacion) {
            const { count: c } = await supabaseAdmin
                .from('v_importaciones_historial')
                .select('*', { count: 'exact', head: true })
                .eq('proveedor', proveedor)
                .lte('creado_el', ultimaImportacion.creado_el);
            loteNum = c || 1;

            const { count: dCount } = await supabaseAdmin
                .from('costos_articulo')
                .select('*', { count: 'exact', head: true })
                .eq('importacion_id', ultimaImportacion.id)
                .eq('estado_match', 'completado')
                .is('confirmado_por', null);
            diffPendienteCount = dCount || 0;

            const { count: mCount } = await supabaseAdmin
                .from('costos_pendientes')
                .select('*', { count: 'exact', head: true })
                .eq('importacion_id', ultimaImportacion.id)
                .eq('resuelto', false);
            diffMatchCount = mCount || 0;
        }

        const isAplicada = ultimaImportacion?.estado === 'completado' && diffPendienteCount === 0 && diffMatchCount === 0;

        const totalPendientes = diffPendienteCount + diffMatchCount;

        const step1 = { 
            state: ultimaImportacion ? 'done' : 'pending',
            subtitle: ultimaImportacion ? 'Lote #' : 'Sin lote'
        };
        const step2 = { 
            state: totalPendientes > 0 ? 'attention' : (ultimaImportacion ? 'skip' : 'pending'),
            subtitle: totalPendientes > 0 ? 'sin confirmar' : (ultimaImportacion ? '0 cambios' : '')
        };
        const step3 = { 
            state: isAplicada ? 'done' : 'pending',
            subtitle: isAplicada ? 'Completado' : 'Pendiente'
        };

        if (!ultimaImportacion || isAplicada) {
            return NextResponse.json({
                importacion: ultimaImportacion,
                step1: { state: 'skip', subtitle: 'Lote al dia' },
                step2: { state: 'skip', subtitle: '0 cambios' },
                step3: { state: 'skip', subtitle: 'Todo al dia' }
            });
        }

        return NextResponse.json({
            importacion: ultimaImportacion,
            step1, step2, step3, diffPendienteCount: totalPendientes
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

