import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const proveedor = searchParams.get('proveedor');

    if (!proveedor) {
        return NextResponse.json({ error: 'Missing proveedor' }, { status: 400 });
    }

    try {
        // 1. Ultima importacion
        const { data: ultimas } = await supabaseAdmin
            .from('v_importaciones_historial')
            .select('*')
            .eq('proveedor', proveedor)
            .order('creado_el', { ascending: false })
            .limit(1);

        const ultimaImportacion = ultimas?.[0] || null;

        let huerfanosCount = 0;
        let diffPendienteCount = 0;

        if (ultimaImportacion) {
            // 2. Huerfanos
            const { count: hCount } = await supabaseAdmin
                .from('costos_pendientes')
                .select('*', { count: 'exact', head: true })
                .eq('importacion_id', ultimaImportacion.id)
                .eq('resuelto', false);
            
            huerfanosCount = hCount || 0;

            // 3. Diff pendiente (costos listos para confirmar)
            const { count: dCount } = await supabaseAdmin
                .from('costos_articulo')
                .select('*', { count: 'exact', head: true })
                .eq('importacion_id', ultimaImportacion.id)
                .eq('estado_match', 'completado')
                .is('confirmado_por', null);

            diffPendienteCount = dCount || 0;
        }

        const isAplicada = ultimaImportacion?.estado === 'completado' && diffPendienteCount === 0 && huerfanosCount === 0;

        const step1 = { 
            state: ultimaImportacion ? 'done' : 'pending',
            subtitle: ultimaImportacion ? `Lote ${ultimaImportacion.id.substring(0,8)}` : 'Sin lote'
        };
        const step2 = { 
            state: huerfanosCount > 0 ? 'attention' : (ultimaImportacion ? 'skip' : 'pending'),
            subtitle: huerfanosCount > 0 ? `${huerfanosCount} pendientes` : '0 pendientes'
        };
        const step3 = { 
            state: diffPendienteCount > 0 ? 'attention' : (isAplicada ? 'done' : (huerfanosCount > 0 ? 'pending' : (ultimaImportacion ? 'skip' : 'pending'))),
            subtitle: diffPendienteCount > 0 ? `${diffPendienteCount} sin confirmar` : (ultimaImportacion ? '0 cambios' : '')
        };
        const step4 = { 
            state: isAplicada ? 'done' : 'pending',
            subtitle: isAplicada ? 'Completado' : 'Pendiente'
        };

        // If no import, everything is "Todo al día" except step 1
        if (!ultimaImportacion || isAplicada) {
            return NextResponse.json({
                importacion: ultimaImportacion,
                step1: { state: 'skip', subtitle: 'Lote al día' },
                step2: { state: 'skip', subtitle: '0 pendientes' },
                step3: { state: 'skip', subtitle: '0 cambios' },
                step4: { state: 'skip', subtitle: 'Todo al día' }
            });
        }

        return NextResponse.json({
            importacion: ultimaImportacion,
            step1, step2, step3, step4, huerfanosCount, diffPendienteCount
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
