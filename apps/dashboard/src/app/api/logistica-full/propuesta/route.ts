import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DIAS_VENTANA = 30;       // horizonte base de demanda (1 mes)
const SEMANAS_HISTORICO = 12;  // semanas para el promedio histórico robusto
const DIAS_HISTORICO = SEMANAS_HISTORICO * 7;
const SEMANAS_POR_MES = 4.33;

// T1 Logística Full — propuesta de reposición.
// Regla: UnidadesRecomendadas = max(0, (Demanda/30) × CoberturaDeseada − StockEfectivo)
// Demanda según método: 'ultimo_mes' | 'historico' | 'hibrido' (default).
// El promedio histórico usa la MEDIANA semanal (robusta a picos irregulares).
// La sugerencia de ML (replenishment_suggested) es solo referencia: NO entra al cálculo.
export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const coberturaDeseada = Number(searchParams.get('cobertura') || 30);
        const metodo = searchParams.get('metodo') || 'hibrido';

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

        // 2. Ventas por artículo: total 30d + buckets semanales (para mediana robusta).
        const desdeHistorico = new Date(Date.now() - DIAS_HISTORICO * 24 * 60 * 60 * 1000).toISOString();
        const corte30 = Date.now() - DIAS_VENTANA * 24 * 60 * 60 * 1000;

        const ventas30 = new Map<string, number>();
        const semanalPorArticulo = new Map<string, number[]>();

        let from = 0;
        const PAGE = 1000;
        while (true) {
            const { data: ventas, error: ventasErr } = await supabaseAdmin
                .from('egresos')
                .select('articulo_id, cantidad, fecha')
                .eq('tipo_egreso', 'venta')
                .gte('fecha', desdeHistorico)
                .range(from, from + PAGE - 1);
            if (ventasErr) throw ventasErr;
            const rows = ventas || [];
            for (const v of rows) {
                const aid = v.articulo_id;
                const cant = Number(v.cantidad || 0);
                const fecha = new Date(v.fecha).getTime();
                if (!Number.isFinite(fecha)) continue;
                // bucket semanal: índice 0..11 (0 = semana más reciente)
                const bucket = Math.floor((Date.now() - fecha) / (7 * 24 * 60 * 60 * 1000));
                if (bucket < 0 || bucket >= SEMANAS_HISTORICO) continue;
                if (fecha >= corte30) ventas30.set(aid, (ventas30.get(aid) || 0) + cant);
                let arr = semanalPorArticulo.get(aid);
                if (!arr) { arr = new Array(SEMANAS_HISTORICO).fill(0); semanalPorArticulo.set(aid, arr); }
                arr[bucket] += cant;
            }
            if (rows.length < PAGE) break;
            from += PAGE;
        }

        // 3. Agrupar por artículo (stock efectivo por inventory_id DISTINTO).
        const byArticle = new Map<string, any>();
        for (const m of (mapeos || []) as any[]) {
            const art: any = m.articulo;
            const pub: any = m.publicacion;
            const aid = m.articulo_id;
            if (!byArticle.has(aid)) {
                byArticle.set(aid, {
                    articulo_id: aid,
                    nombre: art?.nombre || null,
                    es_full: art?.es_full ?? false,
                    disponibles: art?.disponibles != null ? Number(art.disponibles) : null,
                    inventory_ids: new Set<string>(),
                    stock_efectivo: 0,
                    replenishment_suggested: null as number | null,
                    shipping_urgency: null as string | null,
                    packs: [] as any[],
                });
            }
            const entry = byArticle.get(aid);
            const invId = pub?.inventory_id;
            // TODO(tras migración): usar stock_full_total (aptas + tránsito + pendientes).
            const stockEfectivo = pub?.stock_full != null ? Number(pub.stock_full) : 0;
            if (invId && !entry.inventory_ids.has(invId)) {
                entry.inventory_ids.add(invId);
                entry.stock_efectivo += stockEfectivo;
            }
            if (entry.replenishment_suggested == null && pub?.replenishment_suggested != null) {
                entry.replenishment_suggested = Number(pub.replenishment_suggested);
            }
            if (entry.shipping_urgency == null && pub?.shipping_urgency) {
                entry.shipping_urgency = pub.shipping_urgency;
            }
            entry.packs.push({
                inventory_id: invId || null,
                external_item_id: pub?.external_item_id || null,
                stock_full: pub?.stock_full != null ? Number(pub.stock_full) : null,
                stock_full_total: pub?.stock_full_total != null ? Number(pub.stock_full_total) : null,
                precio_venta: pub?.precio_venta ?? null,
                cantidad_requerida: m.cantidad_requerida ?? null,
            });
        }

        // 4. Proyección de demanda robusta y cálculo final.
        const propuesta = [...byArticle.values()].map((e: any) => {
            const v30 = ventas30.get(e.articulo_id) || 0;
            const semanas = semanalPorArticulo.get(e.articulo_id) || new Array(SEMANAS_HISTORICO).fill(0);
            const medianaSemanal = mediana(semanas);
            const vHist = Math.round(medianaSemanal * SEMANAS_POR_MES);

            let demanda: number;
            if (metodo === 'ultimo_mes') demanda = v30;
            else if (metodo === 'historico') demanda = vHist;
            else demanda = Math.min(v30, (v30 + vHist) / 2); // híbrido, limitado a V30

            const demandaDiaria = demanda / DIAS_VENTANA;
            const stockEfectivo = e.stock_efectivo;
            const sugerido = Math.max(0, Math.round(demandaDiaria * coberturaDeseada - stockEfectivo));
            const coberturaActual = demandaDiaria > 0 ? Math.round((stockEfectivo / demandaDiaria) * 10) / 10 : null;

            return {
                articulo_id: e.articulo_id,
                nombre: e.nombre,
                es_full: e.es_full,
                disponibles: e.disponibles,
                inventory_ids: [...e.inventory_ids],
                stock_efectivo: stockEfectivo,
                ventas_30d: v30,
                demanda_historica: vHist,
                demanda: Math.round(demanda),
                demanda_diaria: Math.round(demandaDiaria * 100) / 100,
                cobertura_actual: coberturaActual,
                sugerido,
                sugerencia_ml: e.replenishment_suggested,
                shipping_urgency: e.shipping_urgency,
                packs: e.packs,
            };
        });

        propuesta.sort((a: any, b: any) => (b.sugerido || 0) - (a.sugerido || 0) || (a.nombre || '').localeCompare(b.nombre || ''));

        const totalSugerido = propuesta.reduce((s: number, p: any) => s + (p.sugerido || 0), 0);
        const requierenEnvio = propuesta.filter((p: any) => (p.sugerido || 0) > 0).length;

        return NextResponse.json({
            success: true,
            cobertura_deseada: coberturaDeseada,
            metodo,
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

function mediana(arr: number[]): number {
    const s = [...arr].sort((a, b) => a - b);
    const n = s.length;
    if (n === 0) return 0;
    const mid = Math.floor(n / 2);
    return n % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}
