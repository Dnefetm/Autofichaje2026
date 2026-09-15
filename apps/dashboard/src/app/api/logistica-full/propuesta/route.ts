import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DIAS_VENTANA = 30;
const MESES_HISTORICO = 6;
const DIAS_6MESES = 180;

// T1 Logística Full — propuesta de reposición, AGRUPADA POR CÓDIGO ML (inventory_id).
// Datos de ML (replenishment): sales_30d_full (venta Full 30d), stock_full (aptas),
// stock_full_total (efectivo = aptas + pendientes + en tránsito).
// Regla: sugerido = max(0, (Demanda/30) × CoberturaDeseada − StockEfectivo).
// Sugerencia ML es solo referencia (no entra al cálculo).
export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const coberturaDeseada = Number(searchParams.get('cobertura') || 30);
        const metodo = searchParams.get('metodo') || 'hibrido';
        const accountId = searchParams.get('cuenta') || undefined;

        // 1. Publicaciones Full mapeadas (con artículo + datos de ML).
        let query = supabaseAdmin
            .from('mapeo_publicacion_articulo')
            .select(`
                articulo_id, cantidad_requerida,
                articulo:articulos(articulo_id, nombre),
                publicacion:publicaciones_externas!inner(id, external_item_id, inventory_id, stock_full, stock_full_total, sales_30d_full, replenishment_suggested, shipping_urgency, marketplace_id)
            `)
            .eq('publicacion.logistic_type', 'fulfillment')
            .not('publicacion.inventory_id', 'is', null);
        if (accountId) query = query.eq('publicacion.marketplace_id', accountId);
        const { data: mapeos, error: mapeosErr } = await query;
        if (mapeosErr) throw mapeosErr;

        // 2. Ventas por código ML desde la tabla de agregación diaria.
        //    Fallback: si la tabla aún no existe (migración no aplicada), se usa sales_30d_full de ML.
        const corte30 = Date.now() - DIAS_VENTANA * 24 * 60 * 60 * 1000;
        const ventas30PorCodigo = new Map<string, number>();
        const ventas6mPorCodigo = new Map<string, number>();
        const semanalPorCodigo = new Map<string, number[]>();
        let tieneVentasDiarias = true;
        try {
            let from = 0;
            const PAGE = 1000;
            while (true) {
                const { data: ventas, error: ve } = await supabaseAdmin
                    .from('ventas_diarias_ml')
                    .select('codigo_ml, fecha_dia, unidades_vendidas')
                    .gte('fecha_dia', new Date(Date.now() - DIAS_6MESES * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
                    .range(from, from + PAGE - 1);
                if (ve) throw ve;
                const rows = ventas || [];
                for (const v of rows) {
                    const cod = v.codigo_ml;
                    const uni = Number(v.unidades_vendidas || 0);
                    ventas6mPorCodigo.set(cod, (ventas6mPorCodigo.get(cod) || 0) + uni);
                    const fecha = new Date(v.fecha_dia).getTime();
                    if (Number.isFinite(fecha) && fecha >= corte30) {
                        ventas30PorCodigo.set(cod, (ventas30PorCodigo.get(cod) || 0) + uni);
                    }
                    const bucket = Math.floor((Date.now() - fecha) / (7 * 24 * 60 * 60 * 1000));
                    if (bucket >= 0 && bucket < 12) {
                        let arr = semanalPorCodigo.get(cod);
                        if (!arr) { arr = new Array(12).fill(0); semanalPorCodigo.set(cod, arr); }
                        arr[bucket] += uni;
                    }
                }
                if (rows.length < PAGE) break;
                from += PAGE;
            }
        } catch {
            tieneVentasDiarias = false;
        }

        // 3. Agrupar por CÓDIGO ML (inventory_id).
        const byInv = new Map<string, any>();
        for (const m of (mapeos || []) as any[]) {
            const pub: any = m.publicacion;
            const art: any = m.articulo;
            const inv = pub?.inventory_id;
            if (!inv) continue;
            if (!byInv.has(inv)) {
                byInv.set(inv, {
                    inventory_id: inv,
                    nombre: art?.nombre || null,
                    articulo_id: m.articulo_id,
                    stock_full: pub?.stock_full != null ? Number(pub.stock_full) : 0,
                    stock_full_total: pub?.stock_full_total != null ? Number(pub.stock_full_total) : (pub?.stock_full != null ? Number(pub.stock_full) : 0),
                    sales_30d_full: pub?.sales_30d_full != null ? Number(pub.sales_30d_full) : 0,
                    replenishment_suggested: pub?.replenishment_suggested ?? null,
                    shipping_urgency: pub?.shipping_urgency ?? null,
                });
            }
        }

        // 4. Cálculo por código ML.
        const propuesta = [...byInv.values()].map((e: any) => {
            const cod = e.inventory_id;
            const v30 = tieneVentasDiarias ? (ventas30PorCodigo.get(cod) || 0) : e.sales_30d_full;
            const total6m = ventas6mPorCodigo.get(cod) || 0;
            const vPromedio6m = tieneVentasDiarias ? Math.round(total6m / MESES_HISTORICO) : e.sales_30d_full;
            const semanas = semanalPorCodigo.get(cod) || new Array(12).fill(0);
            const vMediana = Math.round(mediana(semanas) * 4.33);

            let demanda: number;
            if (metodo === 'ultimo_mes') demanda = v30;
            else if (metodo === 'historico_promedio') demanda = vPromedio6m;
            else if (metodo === 'historico_mediana') demanda = vMediana;
            else demanda = Math.min(v30, (v30 + vPromedio6m) / 2);

            const demandaDiaria = demanda / DIAS_VENTANA;
            const efectivo = e.stock_full_total;
            const pendientes = Math.max(0, efectivo - e.stock_full);
            const sugerido = Math.max(0, Math.round(demandaDiaria * coberturaDeseada - efectivo));
            const cobertura = demandaDiaria > 0 ? Math.round((efectivo / demandaDiaria) * 10) / 10 : null;

            return {
                inventory_id: e.inventory_id,
                nombre: e.nombre,
                articulo_id: e.articulo_id,
                ventas_ultimo_mes: v30,
                stock_full: e.stock_full,
                pendientes,
                stock_efectivo: efectivo,
                cobertura_dias: cobertura,
                sugerido,
                sugerencia_ml: e.replenishment_suggested,
                shipping_urgency: e.shipping_urgency,
            };
        });

        propuesta.sort((a: any, b: any) => (b.sugerido || 0) - (a.sugerido || 0) || (a.nombre || '').localeCompare(b.nombre || ''));

        const totalSugerido = propuesta.reduce((s: number, p: any) => s + (p.sugerido || 0), 0);
        const requierenEnvio = propuesta.filter((p: any) => (p.sugerido || 0) > 0).length;

        return NextResponse.json({
            success: true,
            cobertura_deseada: coberturaDeseada,
            metodo,
            total_items: propuesta.length,
            requieren_envio: requierenEnvio,
            total_sugerido: totalSugerido,
            propuesta,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error generando propuesta' }, { status: 500 });
    }
}

function mediana(arr: number[]): number {
    const s = [...arr].sort((a, b) => a - b);
    const n = s.length;
    if (n === 0) return 0;
    const mid = Math.floor(n / 2);
    return n % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}
