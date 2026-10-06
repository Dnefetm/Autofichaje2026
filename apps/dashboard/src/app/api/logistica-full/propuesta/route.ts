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

        // 2. Ventas por (cuenta + código ML) desde la tabla de agregación diaria.
        //    Las cuentas Full están segregadas: las ventas se filtran por marketplace_id
        //    para no mezclar tiendas con inventarios independientes.
        const { data: cuentas } = await supabaseAdmin
            .from('marketplace_configs')
            .select('id, account_name, settings');
        const nombreCuenta = new Map<string, string>();
        for (const c of (cuentas || [])) nombreCuenta.set(c.id, c.settings?.store_name || c.account_name || c.id);

        const corte30 = Date.now() - DIAS_VENTANA * 24 * 60 * 60 * 1000;
        const ventas30PorCuentaCodigo = new Map<string, number>();
        const ventas6mPorCuentaCodigo = new Map<string, number>();
        const semanalPorCuentaCodigo = new Map<string, number[]>();
        let tieneVentasDiarias = true;
        try {
            let from = 0;
            const PAGE = 1000;
            while (true) {
                let vq = supabaseAdmin
                    .from('ventas_diarias_ml')
                    .select('marketplace_id, codigo_ml, fecha_dia, unidades_vendidas')
                    .gte('fecha_dia', new Date(Date.now() - DIAS_6MESES * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
                    .order('marketplace_id')
                    .order('codigo_ml')
                    .order('fecha_dia')
                    .range(from, from + PAGE - 1);
                if (accountId) vq = vq.eq('marketplace_id', accountId);
                const { data: ventas, error: ve } = await vq;
                if (ve) throw ve;
                const rows = ventas || [];
                for (const v of rows) {
                    const key = `${v.marketplace_id}|${v.codigo_ml}`;
                    const uni = Number(v.unidades_vendidas || 0);
                    ventas6mPorCuentaCodigo.set(key, (ventas6mPorCuentaCodigo.get(key) || 0) + uni);
                    const fecha = new Date(v.fecha_dia).getTime();
                    if (Number.isFinite(fecha) && fecha >= corte30) {
                        ventas30PorCuentaCodigo.set(key, (ventas30PorCuentaCodigo.get(key) || 0) + uni);
                    }
                    const bucket = Math.floor((Date.now() - fecha) / (7 * 24 * 60 * 60 * 1000));
                    if (bucket >= 0 && bucket < 12) {
                        let arr = semanalPorCuentaCodigo.get(key);
                        if (!arr) { arr = new Array(12).fill(0); semanalPorCuentaCodigo.set(key, arr); }
                        arr[bucket] += uni;
                    }
                }
                if (rows.length < PAGE) break;
                from += PAGE;
            }
        } catch {
            tieneVentasDiarias = false;
        }

        // 3. Agrupar por (CUENTA, código ML), sumando stock entre listings de la misma cuenta.
        const byCuentaInv = new Map<string, any>();
        for (const m of (mapeos || []) as any[]) {
            const pub: any = m.publicacion;
            const art: any = m.articulo;
            const inv = pub?.inventory_id;
            const mk = pub?.marketplace_id;
            if (!inv || !mk) continue;
            const key = `${mk}|${inv}`;
            if (!byCuentaInv.has(key)) {
                byCuentaInv.set(key, {
                    marketplace_id: mk,
                    cuenta: nombreCuenta.get(mk) || '—',
                    inventory_id: inv,
                    nombre: art?.nombre || null,
                    articulo_id: m.articulo_id,
                    stock_full: 0,
                    stock_full_total: null,
                    sales_30d_full: 0,
                    replenishment_suggested: null,
                    shipping_urgency: null,
                });
            }
            const e = byCuentaInv.get(key);
            // stock_full YA es el total del inventario: syncFullStock escribe el mismo
            // available_quantity en todas las listings del inventory_id. Se toma el MÁXIMO,
            // no la suma, para no duplicar el total.
            e.stock_full = Math.max(e.stock_full, pub?.stock_full != null ? Number(pub.stock_full) : 0);
            if (pub?.stock_full_total != null) {
                e.stock_full_total = Math.max(e.stock_full_total ?? 0, Number(pub.stock_full_total));
            }
            e.sales_30d_full = Math.max(e.sales_30d_full, pub?.sales_30d_full != null ? Number(pub.sales_30d_full) : 0);
            if (pub?.replenishment_suggested != null) e.replenishment_suggested = pub.replenishment_suggested;
            if (pub?.shipping_urgency != null) e.shipping_urgency = pub.shipping_urgency;
        }

        // 4. Cálculo por (cuenta, código ML).
        const propuesta = [...byCuentaInv.values()].map((e: any) => {
            const key = `${e.marketplace_id}|${e.inventory_id}`;
            const v30 = tieneVentasDiarias ? (ventas30PorCuentaCodigo.get(key) || 0) : e.sales_30d_full;
            const total6m = ventas6mPorCuentaCodigo.get(key) || 0;
            const vPromedio6m = tieneVentasDiarias ? Math.round(total6m / MESES_HISTORICO) : e.sales_30d_full;
            const semanas = semanalPorCuentaCodigo.get(key) || new Array(12).fill(0);
            const vMediana = Math.round(mediana(semanas) * 4.33);

            let demanda: number;
            if (metodo === 'ultimo_mes') demanda = v30;
            else if (metodo === 'historico_promedio') demanda = vPromedio6m;
            else if (metodo === 'historico_mediana') demanda = vMediana;
            else demanda = Math.min(v30, (v30 + vPromedio6m) / 2);

            const demandaDiaria = demanda / DIAS_VENTANA;
            // efectivo = aptas + pendientes + en tránsito; si ML no lo entregó, se usa solo aptas.
            const efectivo = e.stock_full_total != null ? e.stock_full_total : e.stock_full;
            const pendientes = e.stock_full_total != null ? Math.max(0, e.stock_full_total - e.stock_full) : null;
            const sugerido = Math.max(0, Math.round(demandaDiaria * coberturaDeseada - efectivo));
            const cobertura = demandaDiaria > 0 ? Math.round((efectivo / demandaDiaria) * 10) / 10 : null;

            return {
                marketplace_id: e.marketplace_id,
                cuenta: e.cuenta,
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
