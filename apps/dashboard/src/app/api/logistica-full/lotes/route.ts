import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DIAS = 30;

// T1 Logística Full — lista los envíos Full (agrupados por "guia", el número de
// envío/importación de MeLi) con su estado de avance (Pendiente / Reunido / Preparado).
// Nota: importacion_full_id es único por egreso; el agrupador real es "guia".
export async function GET() {
    try {
        const desde = new Date(Date.now() - DIAS * 24 * 60 * 60 * 1000).toISOString();

        const envios = new Map<string, any>();
        let from = 0;
        const PAGE = 1000;
        while (true) {
            const { data, error } = await supabaseAdmin
                .from('egresos')
                .select('guia, articulo_id, cantidad, edo_reunido, fecha_preparado, fecha, creado_el')
                .eq('tipo_egreso', 'envio_full')
                .gte('creado_el', desde)
                .order('creado_el', { ascending: false })
                .range(from, from + PAGE - 1);
            if (error) throw error;
            const rows = data || [];
            for (const r of rows) {
                const key = r.guia || 'sin_guia';
                if (!envios.has(key)) {
                    envios.set(key, {
                        guia: key,
                        count: 0,
                        cantidad: 0,
                        pendiente: 0,
                        reunido: 0,
                        preparado: 0,
                        fecha: r.fecha,
                        creado_el: r.creado_el,
                    });
                }
                const e = envios.get(key);
                e.count++;
                e.cantidad += Number(r.cantidad || 0);
                if (r.edo_reunido === 'Preparado') e.preparado++;
                else if (r.edo_reunido === 'Reunido') e.reunido++;
                else e.pendiente++;
                if (r.fecha && (!e.fecha || r.fecha > e.fecha)) e.fecha = r.fecha;
                if (r.creado_el && (!e.creado_el || r.creado_el > e.creado_el)) e.creado_el = r.creado_el;
            }
            if (rows.length < PAGE) break;
            from += PAGE;
        }

        const list = [...envios.values()].map(e => {
            let estado = 'Pendiente';
            if (e.preparado > 0 && e.pendiente === 0 && e.reunido === 0) estado = 'Preparado';
            else if (e.reunido > 0 || e.preparado > 0) estado = 'Reunido';
            return { ...e, estado };
        }).sort((a, b) => (b.creado_el || '').localeCompare(a.creado_el || ''));

        const activos = list.filter(e => e.estado !== 'Preparado').length;

        return NextResponse.json({
            success: true,
            dias_ventana: DIAS,
            total_envios: list.length,
            envios_activos: activos,
            envios: list,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error listando envíos Full' }, { status: 500 });
    }
}
