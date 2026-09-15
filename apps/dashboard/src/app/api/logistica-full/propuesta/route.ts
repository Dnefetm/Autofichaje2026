import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DIAS_VENTANA = 60;

// T1 Logística Full — propuesta de reposición.
// Para cada publicación Full mapeada: compara el stock en el depósito Full
// (stock_full, ya sincronizado) contra las ventas de los últimos 60 días y
// sugiere cuánto enviar. El operario decide finalmente.
export async function GET() {
    try {
        // 1. Publicaciones Full mapeadas (con artículo y stock Full).
        const { data: mapeos, error: mapeosErr } = await supabaseAdmin
            .from('mapeo_publicacion_articulo')
            .select(`
                articulo_id,
                cantidad_requerida,
                articulo:articulos(articulo_id, nombre, disponibles, es_full),
                publicacion:publicaciones_externas!inner(id, external_item_id, inventory_id, stock_full, precio_venta, sold_quantity)
            `)
            .eq('publicacion.logistic_type', 'fulfillment')
            .not('publicacion.inventory_id', 'is', null);

        if (mapeosErr) throw mapeosErr;

        // 2. Ventas de los últimos 60 días por artículo.
        const desde = new Date(Date.now() - DIAS_VENTANA * 24 * 60 * 60 * 1000).toISOString();
        const ventasPorArticulo = new Map<string, number>();

        let from = 0;
        const PAGE = 1000;
        while (true) {
            const { data: ventas, error: ventasErr } = await supabaseAdmin
                .from('egresos')
                .select('articulo_id, cantidad')
                .eq('tipo_egreso', 'venta')
                .gte('fecha', desde)
                .range(from, from + PAGE - 1);
            if (ventasErr) throw ventasErr;
            const rows = ventas || [];
            rows.forEach(v => {
                ventasPorArticulo.set(v.articulo_id, (ventasPorArticulo.get(v.articulo_id) || 0) + Number(v.cantidad || 0));
            });
            if (rows.length < PAGE) break;
            from += PAGE;
        }

        // 3. Armar la propuesta.
        const propuesta = (mapeos || []).map((m: any) => {
            const art = m.articulo;
            const pub = m.publicacion;
            const ventas60 = ventasPorArticulo.get(m.articulo_id) || 0;
            const stockFull = pub?.stock_full != null ? Number(pub.stock_full) : null;
            const sugerido = stockFull != null ? Math.max(0, ventas60 - stockFull) : null;
            return {
                articulo_id: m.articulo_id,
                nombre: art?.nombre || null,
                es_full: art?.es_full ?? false,
                disponibles: art?.disponibles != null ? Number(art.disponibles) : null,
                inventory_id: pub?.inventory_id || null,
                external_item_id: pub?.external_item_id || null,
                stock_full: stockFull,
                precio_venta: pub?.precio_venta,
                sold_quantity: pub?.sold_quantity,
                ventas_60d: ventas60,
                sugerido,
            };
        });

        // Ordenar: primero los que requieren envío (sugerido > 0), luego por nombre.
        propuesta.sort((a: any, b: any) => {
            const ra = a.sugerido ?? -1;
            const rb = b.sugerido ?? -1;
            if (ra !== rb) return rb - ra;
            return (a.nombre || '').localeCompare(b.nombre || '');
        });

        const totalSugerido = propuesta.reduce((s: number, p: any) => s + (p.sugerido || 0), 0);
        const requierenEnvio = propuesta.filter((p: any) => (p.sugerido || 0) > 0).length;

        return NextResponse.json({
            success: true,
            dias_ventana: DIAS_VENTANA,
            total_items: propuesta.length,
            requieren_envio: requierenEnvio,
            total_sugerido: totalSugerido,
            propuesta,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error generando propuesta' }, { status: 500 });
    }
}
