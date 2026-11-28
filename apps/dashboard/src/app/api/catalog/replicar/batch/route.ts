import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { dispatchWorker } from '@/lib/dispatch-worker';
import {
    buildReplicationIdempotencyKey,
    normalizeReplicationPolicies,
} from '@/lib/replication-batch';

export const dynamic = 'force-dynamic';

/**
 * GET /api/catalog/replicar/batch
 * Lista los últimos 20 lotes de replicación multi-cuenta.
 */
export async function GET() {
    try {
        const [{ data: batches, error }, { data: accounts }] = await Promise.all([
            supabaseAdmin
                .from('replication_batches')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(20),
            supabaseAdmin.from('marketplace_configs').select('id, account_name'),
        ]);
        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }
        const acctName = new Map((accounts || []).map((a: any) => [a.id, a.account_name]));
        const enriched = (batches || []).map((b: any) => ({
            ...b,
            source_account_name: acctName.get(b.source_marketplace_id) || b.source_marketplace_id,
            target_account_name: acctName.get(b.target_marketplace_id) || b.target_marketplace_id,
        }));
        return NextResponse.json({ ok: true, batches: enriched });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err?.message || 'Error cargando lotes' }, { status: 500 });
    }
}

/**
 * POST /api/catalog/replicar/batch
 * Crea un lote (máx 50 ítems) con idempotencia y encola jobs `replicate_item` en el worker.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => null);
        const sourceId = body?.source_marketplace_id?.trim() || '';
        const targetId = body?.target_marketplace_id?.trim() || '';
        const rawPubIds: string[] = Array.isArray(body?.publicacion_ids) ? body.publicacion_ids : [];
        const pubIds = Array.from(new Set(rawPubIds.map(s => String(s || '').trim()).filter(Boolean)));
        const forceDuplicateIds = new Set<string>(
            Array.isArray(body?.force_duplicate_ids) ? body.force_duplicate_ids.map((s: any) => String(s)) : [],
        );

        if (!sourceId || !targetId || sourceId === targetId) {
            return NextResponse.json({ ok: false, error: 'Cuentas origen/destino inválidas' }, { status: 400 });
        }
        if (pubIds.length === 0 || pubIds.length > 50) {
            return NextResponse.json({ ok: false, error: 'Cada lote debe tener entre 1 y 50 publicaciones' }, { status: 400 });
        }

        const policies = normalizeReplicationPolicies(body?.policies);

        // 1. Cargar datos base de las publicaciones origen + mapeos + hijos catálogo
        const [{ data: pubs, error: pubErr }, { data: maps }] = await Promise.all([
            supabaseAdmin
                .from('publicaciones_externas')
                .select(`
                    id, marketplace_id, external_item_id, titulo, precio_venta,
                    stock_publicado, listing_type_id, category_id, free_shipping,
                    logistic_type, seller_sku, seller_custom_field, gtin, ean, id_producto_catalogo
                `)
                .in('id', pubIds),
            supabaseAdmin
                .from('mapeo_publicacion_articulo')
                .select('publicacion_id, articulo_id, cantidad_requerida, articulos(codigo_universal)')
                .in('publicacion_id', pubIds),
        ]);

        if (pubErr || !pubs?.length) {
            return NextResponse.json({ ok: false, error: pubErr?.message || 'No se encontraron publicaciones origen' }, { status: 404 });
        }

        const mapByPub = new Map<string, any>();
        for (const m of maps || []) {
            if (!mapByPub.has(m.publicacion_id)) mapByPub.set(m.publicacion_id, m);
        }

        const itemIds = pubs.map((p: any) => p.external_item_id).filter(Boolean);
        const { data: childRows } = await supabaseAdmin
            .from('publicaciones_externas')
            .select('par_item_id, id_producto_catalogo')
            .eq('marketplace_id', sourceId)
            .in('par_item_id', itemIds)
            .not('id_producto_catalogo', 'is', null)
            .neq('status_externo', 'closed');

        const catChildByPar = new Map<string, string>();
        for (const c of childRows || []) {
            if (c.par_item_id && c.id_producto_catalogo && !catChildByPar.has(c.par_item_id)) {
                catChildByPar.set(c.par_item_id, c.id_producto_catalogo);
            }
        }

        // Deduplicar intra-lote por idempotency_key (ej. 2 publicaciones de origen mapeadas al mismo artículo+pack)
        const prepared: Array<{
            pub: any;
            articulo_id: string | null;
            cantidad_requerida: number;
            idempotency_key: string;
            metadata: Record<string, any>;
        }> = [];
        const seenKeys = new Set<string>();
        let skippedDuplicates = 0;

        const orderMap = new Map(pubIds.map((id, i) => [id, i]));
        const sortedPubs = [...pubs].sort((a: any, b: any) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));

        for (const p of sortedPubs) {
            const m = mapByPub.get(p.id);
            const artId: string | null = m?.articulo_id ?? null;
            const packQty = Math.max(1, Number(m?.cantidad_requerida || 1));
            const key = buildReplicationIdempotencyKey({
                articulo_id: artId,
                cantidad_requerida: packQty,
                source_item_id: p.external_item_id,
                target_marketplace_id: targetId,
            });
            if (seenKeys.has(key)) {
                skippedDuplicates++;
                continue;
            }
            seenKeys.add(key);

            const art = m?.articulos ? (Array.isArray(m.articulos) ? m.articulos[0] : m.articulos) : null;
            const rawSku = String(p.seller_custom_field || p.seller_sku || '').trim();
            const cleanSku = rawSku && !/^[0-9a-f]{8}$/i.test(rawSku) ? rawSku : null;
            const effectiveGtin = String(p.gtin || p.ean || art?.codigo_universal || '').trim() || null;

            prepared.push({
                pub: p,
                articulo_id: artId,
                cantidad_requerida: packQty,
                idempotency_key: key,
                metadata: {
                    listing_type_id: p.listing_type_id || 'gold_special',
                    free_shipping: Boolean(p.free_shipping),
                    source_price: p.precio_venta != null ? Number(p.precio_venta) : null,
                    logistic_type: p.logistic_type ?? null,
                    seller_sku: cleanSku,
                    gtin: effectiveGtin,
                    effective_catalog_product_id: p.id_producto_catalogo || catChildByPar.get(p.external_item_id) || null,
                    force_duplicate: forceDuplicateIds.has(p.id),
                },
            });
        }

        if (prepared.length === 0) {
            return NextResponse.json({ ok: false, error: 'Todas las filas seleccionadas quedaron deduplicadas sin ítems por procesar' }, { status: 400 });
        }

        // Evitar duplicar ítems que ya están en ejecución o completados recientemente en otro lote vivo hacia la misma cuenta destino
        const candidateKeys = prepared.map(x => x.idempotency_key);
        const { data: existingActiveItems } = await supabaseAdmin
            .from('replication_batch_items')
            .select('idempotency_key')
            .eq('target_marketplace_id', targetId)
            .in('idempotency_key', candidateKeys)
            .in('status', ['pending', 'processing', 'waiting_optin', 'completed']);

        const activeKeySet = new Set((existingActiveItems || []).map((r: any) => r.idempotency_key));
        const toInsert = prepared.filter(x => {
            if (activeKeySet.has(x.idempotency_key) && !x.metadata.force_duplicate) {
                skippedDuplicates++;
                return false;
            }
            return true;
        });

        if (toInsert.length === 0) {
            return NextResponse.json({
                ok: false,
                error: 'Los ítems seleccionados ya fueron replicados o están en cola activa hacia esta cuenta destino.',
                skipped_duplicates: skippedDuplicates,
            }, { status: 409 });
        }

        // 2. Crear registro padre replication_batches
        const { data: batch, error: batchErr } = await supabaseAdmin
            .from('replication_batches')
            .insert({
                source_marketplace_id: sourceId,
                target_marketplace_id: targetId,
                status: 'running',
                total_items: toInsert.length,
                policies,
            })
            .select('*')
            .single();

        if (batchErr || !batch) {
            return NextResponse.json({ ok: false, error: batchErr?.message || 'Error creando lote' }, { status: 500 });
        }

        // 3. Insertar replication_batch_items
        const { data: insertedItems, error: itemsErr } = await supabaseAdmin
            .from('replication_batch_items')
            .insert(
                toInsert.map(x => ({
                    batch_id: batch.id,
                    source_publicacion_id: x.pub.id,
                    source_item_id: x.pub.external_item_id,
                    source_title: x.pub.titulo,
                    articulo_id: x.articulo_id,
                    cantidad_requerida: x.cantidad_requerida,
                    target_marketplace_id: targetId,
                    idempotency_key: x.idempotency_key,
                    status: 'pending',
                    metadata: x.metadata,
                })),
            )
            .select('id');

        if (itemsErr || !insertedItems) {
            await supabaseAdmin.from('replication_batches').delete().eq('id', batch.id);
            return NextResponse.json({ ok: false, error: itemsErr?.message || 'Error insertando ítems del lote' }, { status: 500 });
        }

        // 4. Encolar jobs `replicate_item` y vincular `job_id`
        const nowIso = new Date().toISOString();
        const jobsPayload = insertedItems.map((it: any) => ({
            type: 'replicate_item',
            payload: { batch_id: batch.id, batch_item_id: it.id },
            status: 'pending',
            priority: 7,
            max_attempts: 3,
            scheduled_at: nowIso,
        }));

        const { data: insertedJobs, error: jobsErr } = await supabaseAdmin
            .from('jobs')
            .insert(jobsPayload)
            .select('id, payload');

        if (jobsErr) {
            await supabaseAdmin.from('replication_batches').update({ status: 'cancelled' }).eq('id', batch.id);
            return NextResponse.json({ ok: false, error: `Error encolando jobs: ${jobsErr.message}` }, { status: 500 });
        }

        if (insertedJobs && insertedJobs.length > 0) {
            await Promise.all(
                insertedJobs.map((j: any) => {
                    const biId = j.payload?.batch_item_id;
                    if (!biId) return Promise.resolve();
                    return supabaseAdmin
                        .from('replication_batch_items')
                        .update({ job_id: j.id })
                        .eq('id', biId);
                }),
            );
        }

        // 5. Disparar worker inmediatamente (fire-and-forget protegido)
        dispatchWorker().catch(() => {});

        return NextResponse.json({
            ok: true,
            batch_id: batch.id,
            queued_count: insertedItems.length,
            skipped_duplicates: skippedDuplicates,
        });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err?.message || 'Error iniciando lote de replicación' }, { status: 500 });
    }
}
