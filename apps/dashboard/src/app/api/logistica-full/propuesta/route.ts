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
                publicacion:publicaciones_externas!inner(id, external_item_id, inventory_id, stock_full, stock_full_total, sales_30d_full, replenishment_suggested, shipping_urgency, marketplace_id, seller_sku, ean, gtin, upc)
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
                    componentes: {} as Record<string, number>,
                    seller_sku: pub?.seller_sku || null,
                    codigo_universal: pub?.ean || pub?.gtin || pub?.upc || null,
                    stock_full: 0,
                    stock_full_total: null,
                    sales_30d_full: 0,
                    replenishment_suggested: null,
                    shipping_urgency: null,
                });
            }
            const e = byCuentaInv.get(key);
            if (m.articulo_id) {
                // Componente del kit: cuántas unidades de este artículo físico se requieren
                // para construir UNA unidad Full. Puede haber varios componentes por inventory_id.
                e.componentes[m.articulo_id] = Math.max(1, Number(m.cantidad_requerida) || 1);
            }
            if (!e.seller_sku && pub?.seller_sku) e.seller_sku = pub.seller_sku;
            if (!e.codigo_universal && (pub?.ean || pub?.gtin || pub?.upc)) {
                e.codigo_universal = pub?.ean || pub?.gtin || pub?.upc;
            }
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

        // Stock de bodega (inventory_snapshot) por CADA componente del kit mapeado.
        const articuloIds = [...new Set([...byCuentaInv.values()].flatMap((e: any) => Object.keys(e.componentes || {})))] as string[];
        const stockBodegaMap = new Map<string, { physical: number; disponible: number }>();
        for (let i = 0; i < articuloIds.length; i += 200) {
            const chunk = articuloIds.slice(i, i + 200);
            const { data: snaps } = await supabaseAdmin
                .from('inventory_snapshot')
                .select('sku, physical_stock, dropship_stock, reserved_stock')
                .in('sku', chunk);
            for (const s of (snaps || [])) {
                const physical = Number(s.physical_stock || 0);
                const disponible = physical + Number(s.dropship_stock || 0) - Number(s.reserved_stock || 0);
                stockBodegaMap.set(s.sku, { physical, disponible });
            }
        }

        // "En camino" LOCAL: piezas Full declaradas en egresos envio_full activos.
        // Reemplaza el stock_full_total de MeLi (gated por fecha de envío y que solo se
        // refresca en ventas). Solo cuentan los egresos 'en_camino' (nuevos, no recibidos
        // ni cancelados). Se dedupe por (guía, código) porque un kit tiene 1 egreso por componente.
        const enCaminoPorCodigo = new Map<string, number>();
        {
            const { data: egresosActivos } = await supabaseAdmin
                .from('egresos')
                .select('guia, codigo_ml, unidades_full')
                .eq('tipo_egreso', 'envio_full')
                .eq('estado_envio', 'en_camino');
            const vistos = new Set<string>();
            for (const g of (egresosActivos || [])) {
                const cod = g.codigo_ml;
                const un = Number(g.unidades_full || 0);
                if (!cod || !un) continue;
                const k = `${g.guia}|${cod}`;
                if (vistos.has(k)) continue;
                vistos.add(k);
                enCaminoPorCodigo.set(cod, (enCaminoPorCodigo.get(cod) || 0) + un);
            }
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
            // "En camino" local (declarado en egresos) + aptas de MeLi = efectivo para decidir
            // cuánto enviar. Ya no se depende de stock_full_total (gated por fecha de envío).
            const pendientes = enCaminoPorCodigo.get(e.inventory_id) || 0;
            const efectivo = e.stock_full + pendientes;
            // Stock de bodega = unidades Full CONSTRUIBLES con el stock físico actual.
            // Para cada componente: piso(stock_componente / cantidad_requerida); el kit se
            // construye al ritmo del componente más limitante (mínimo).
            const comps = Object.entries(e.componentes || {}) as [string, number][];
            let construible = 0;
            let construibleDisponible = 0;
            if (comps.length) {
                construible = Infinity;
                construibleDisponible = Infinity;
                for (const [artId, qty] of comps) {
                    const snap = stockBodegaMap.get(artId);
                    construible = Math.min(construible, Math.floor((snap?.physical ?? 0) / qty));
                    construibleDisponible = Math.min(construibleDisponible, Math.floor((snap?.disponible ?? 0) / qty));
                }
                if (!Number.isFinite(construible)) construible = 0;
                if (!Number.isFinite(construibleDisponible)) construibleDisponible = 0;
            }

            // A enviar = lo que Full necesita, acotado a lo que puedo construir ya (no puedo enviar
            // más de lo que tengo componentes para armar).
            const necesario = Math.max(0, Math.round(demandaDiaria * coberturaDeseada - efectivo));
            const sugerido = Math.min(necesario, construible);
            const cobertura = demandaDiaria > 0 ? Math.round((efectivo / demandaDiaria) * 10) / 10 : null;

            return {
                marketplace_id: e.marketplace_id,
                cuenta: e.cuenta,
                inventory_id: e.inventory_id,
                nombre: e.nombre,
                articulo_id: e.articulo_id,
                seller_sku: e.seller_sku,
                codigo_universal: e.codigo_universal,
                ventas_ultimo_mes: v30,
                stock_full: e.stock_full,
                stock_bodega: construible,
                stock_disponible: construibleDisponible,
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
