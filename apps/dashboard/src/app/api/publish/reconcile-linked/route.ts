/**
 * POST /api/publish/reconcile-linked
 *
 * Reconciliar las publicaciones/vitrinas enlazadas a un artículo contra MeLi.
 * Detecta "fantasmas": items que la BD aún marca como activos pero que ya fueron
 * eliminados/cerrados en Mercado Libre. Los marca como "closed" en BD y NO los
 * devuelve en la lista de vitrinas vivas.
 *
 * Body: { articulo_id: string }
 *
 * Respuesta:
 * {
 *   ok: true,
 *   revisadas: number,                 // total de vitrinas enlazadas revisadas
 *   ocultadas: number,                 // cuántas se marcaron como cerradas/eliminadas
 *   ocultadas_detalle: [{ item_id, motivo }],
 *   pubs: [...]                        // solo vitrinas vivas (active/paused/under_review)
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';

export const dynamic = 'force-dynamic';

const ALIVE_STATUSES = new Set(['active', 'paused', 'under_review']);
const DEAD_STATUSES = new Set(['closed', 'inactive', 'deleted']);

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => null);
        if (!body?.articulo_id) {
            return NextResponse.json({ ok: false, error: 'Se requiere articulo_id' }, { status: 400 });
        }
        const { articulo_id } = body;

        // 1. Obtener publicaciones enlazadas vía mapeo
        const { data: mappings, error: mapErr } = await supabaseAdmin
            .from('mapeo_publicacion_articulo')
            .select(`
                publicacion_id,
                publicaciones_externas!inner(
                    id, marketplace_id, external_item_id, status_externo, titulo,
                    tipo_publicacion, listing_type_id, free_shipping, precio_venta,
                    stock_publicado, logistic_type, permalink,
                    marketplace_configs(account_name)
                )
            `)
            .eq('articulo_id', articulo_id);

        if (mapErr) {
            return NextResponse.json({ ok: false, error: mapErr.message }, { status: 500 });
        }

        const pubs = (mappings || [])
            .map((m: any) => m.publicaciones_externas)
            .filter(Boolean);

        if (pubs.length === 0) {
            return NextResponse.json({ ok: true, revisadas: 0, ocultadas: 0, ocultadas_detalle: [], pubs: [] });
        }

        // 2. Agrupar por cuenta para usar multiGET (20 ids por request)
        const byAccount = new Map<string, any[]>();
        for (const p of pubs) {
            if (!p.marketplace_id || !p.external_item_id) continue;
            const list = byAccount.get(p.marketplace_id) || [];
            list.push(p);
            byAccount.set(p.marketplace_id, list);
        }

        const meli = new MeliAdapter();
        const toClose = new Map<string, string>(); // external_item_id -> motivo

        for (const [accountId, accountPubs] of byAccount.entries()) {
            const itemIds = accountPubs.map((p: any) => p.external_item_id);

            // 2a. Batch: status + stock + sub_status (multiGET)
            let batch: Map<string, { qty: number; status: string; sub_status: string[] }> = new Map();
            try {
                batch = await (meli as any).getStockAndStatusBatch(accountId, itemIds);
            } catch (e: any) {
                // batch falló — se intentará ítem por ítem abajo
                batch = new Map();
            }

            // 2b. Evaluar cada publicación
            for (const p of accountPubs) {
                const itemId: string = p.external_item_id;
                const inBatch = batch.get(itemId);

                if (inBatch) {
                    if (DEAD_STATUSES.has(inBatch.status)) {
                        toClose.set(itemId, `status real en MeLi: ${inBatch.status}`);
                    }
                    continue;
                }

                // No está en el batch → puede ser eliminado (404) o fallo puntual del chunk.
                // Confirmar con GET individual para no marcar erróneamente.
                try {
                    const st = await (meli as any).getItemStatus(accountId, itemId);
                    if (!st.exists || DEAD_STATUSES.has(st.status)) {
                        toClose.set(itemId, st.exists ? `status real: ${st.status}` : 'eliminado en MeLi (404)');
                    }
                } catch (e: any) {
                    // 401/429/red: no tocar este ítem — asumir que sigue vivo para no ocultar de más
                    continue;
                }
            }
        }

        // 3. Persistir el cierre de los fantasmas
        let ocultadas = 0;
        const ocultadasDetalle: Array<{ item_id: string; motivo: string }> = [];
        for (const [itemId, motivo] of toClose.entries()) {
            // marketplace_id puede variar por item; lo tomamos del mapa original
            const pubRow = pubs.find((p: any) => p.external_item_id === itemId);
            if (!pubRow?.marketplace_id) continue;
            const { error } = await supabaseAdmin
                .from('publicaciones_externas')
                .update({
                    status_externo: 'closed',
                    sub_status: ['reconciliado'],
                    actualizado_el: new Date().toISOString(),
                })
                .eq('marketplace_id', pubRow.marketplace_id)
                .eq('external_item_id', itemId);
            if (!error) {
                ocultadas++;
                ocultadasDetalle.push({ item_id: itemId, motivo });
            }
        }

        // 4. Devolver SOLO las vitrinas vivas (ya reconciliadas)
        const vivos = pubs
            .filter((p: any) => ALIVE_STATUSES.has(p.status_externo) && !toClose.has(p.external_item_id))
            .map((p: any) => ({
                id: p.id,
                external_item_id: p.external_item_id,
                titulo: p.titulo,
                tipo_publicacion: p.tipo_publicacion,
                listing_type_id: p.listing_type_id,
                free_shipping: p.free_shipping,
                status_externo: p.status_externo,
                precio_venta: p.precio_venta,
                stock_publicado: p.stock_publicado,
                logistic_type: p.logistic_type,
                permalink: p.permalink,
                marketplace_id: p.marketplace_id,
                account_name: p.marketplace_configs?.account_name || null,
            }));

        return NextResponse.json({
            ok: true,
            revisadas: pubs.length,
            ocultadas,
            ocultadas_detalle: ocultadasDetalle,
            pubs: vivos,
        });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err.message || 'Error en reconciliación' }, { status: 500 });
    }
}
