import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DIAS = 30;

// T1 Logística Full — lista los lotes de envío Full (agrupados por importacion_full_id)
// con su estado de avance (Pendiente / Reunido / Preparado) según los egresos.
export async function GET() {
    try {
        const desde = new Date(Date.now() - DIAS * 24 * 60 * 60 * 1000).toISOString();

        const lotes = new Map<string, any>();
        let from = 0;
        const PAGE = 1000;
        while (true) {
            const { data, error } = await supabaseAdmin
                .from('egresos')
                .select('importacion_full_id, articulo_id, cantidad, edo_reunido, fecha_preparado, creado_el')
                .eq('tipo_egreso', 'envio_full')
                .gte('creado_el', desde)
                .order('creado_el', { ascending: false })
                .range(from, from + PAGE - 1);
            if (error) throw error;
            const rows = data || [];
            for (const r of rows) {
                const key = r.importacion_full_id || 'sin_lote';
                if (!lotes.has(key)) {
                    lotes.set(key, {
                        importacion_full_id: key,
                        count: 0,
                        cantidad: 0,
                        pendiente: 0,
                        reunido: 0,
                        preparado: 0,
                        creado_el: r.creado_el,
                    });
                }
                const l = lotes.get(key);
                l.count++;
                l.cantidad += Number(r.cantidad || 0);
                if (r.edo_reunido === 'Preparado') l.preparado++;
                else if (r.edo_reunido === 'Reunido') l.reunido++;
                else l.pendiente++;
                if (r.creado_el && (!l.creado_el || r.creado_el > l.creado_el)) l.creado_el = r.creado_el;
            }
            if (rows.length < PAGE) break;
            from += PAGE;
        }

        const list = [...lotes.values()].map(l => {
            let estado = 'Pendiente';
            if (l.preparado > 0 && l.pendiente === 0 && l.reunido === 0) estado = 'Preparado';
            else if (l.reunido > 0 || l.preparado > 0) estado = 'Reunido';
            return { ...l, estado };
        }).sort((a, b) => (b.creado_el || '').localeCompare(a.creado_el || ''));

        const activos = list.filter(l => l.estado !== 'Preparado').length;

        return NextResponse.json({
            success: true,
            dias_ventana: DIAS,
            total_lotes: list.length,
            lotes_activos: activos,
            lotes: list,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error listando lotes Full' }, { status: 500 });
    }
}
