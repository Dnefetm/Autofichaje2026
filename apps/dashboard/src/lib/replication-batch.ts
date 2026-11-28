/**
 * Helpers compartidos para lotes de replicación multi-cuenta (Fases 3-5).
 * Centraliza la llave de idempotencia y la agregación de progreso / condición de parada.
 */

export interface ReplicationPolicies {
    price_policy: 'target_engine' | 'keep_source';
    catalog_policy: 'auto_catalog' | 'traditional_only';
    title_policy: 'ai_60' | 'keep_source';
    initial_state_policy: 'active' | 'paused';
    stock_buffer_two_accounts: boolean;
}

export const DEFAULT_REPLICATION_POLICIES: ReplicationPolicies = {
    price_policy: 'target_engine',
    catalog_policy: 'auto_catalog',
    title_policy: 'ai_60',
    initial_state_policy: 'active',
    stock_buffer_two_accounts: true,
};

export interface ReplicationBatchSummary {
    id: string;
    source_marketplace_id: string;
    target_marketplace_id: string;
    status: string;
    total_items: number;
    completed_count: number;
    waiting_optin_count: number;
    linked_existing_count: number;
    failed_count: number;
    skipped_count: number;
    policies: ReplicationPolicies;
    created_at: string;
    updated_at: string;
    finished_at: string | null;
}

export interface PreflightItem {
    publicacion_id: string;
    external_item_id: string;
    titulo: string;
    url_imagen: string | null;
    brand: string | null;
    category_id: string | null;
    listing_type_id: string | null;
    logistic_type: string | null;
    articulo_id: string | null;
    cantidad_requerida: number;
    effective_sku: string | null;
    effective_gtin: string | null;
    effective_catalog_product_id: string | null;
    variations_count: number;
    source_price: number | null;
    target_price: number | null;
    price_source: string;
    local_stock: number | null;
    source_stock: number | null;
    will_pause_by_buffer: boolean;
    will_pause_by_full: boolean;
    duplicate_level: 'free' | 'warning' | 'exact';
    duplicate_summary: string;
    duplicate_item_id: string | null;
    gtin_status: 'ok' | 'missing_optional' | 'missing_required_for_brand' | 'invalid';
    gtin_note: string | null;
    status: 'ready' | 'warning' | 'blocker';
    warnings: string[];
    blockers: string[];
}

export function normalizeReplicationPolicies(raw: Partial<ReplicationPolicies> | null | undefined): ReplicationPolicies {
    return {
        price_policy: raw?.price_policy === 'keep_source' ? 'keep_source' : 'target_engine',
        catalog_policy: raw?.catalog_policy === 'traditional_only' ? 'traditional_only' : 'auto_catalog',
        title_policy: raw?.title_policy === 'keep_source' ? 'keep_source' : 'ai_60',
        initial_state_policy: raw?.initial_state_policy === 'paused' ? 'paused' : 'active',
        stock_buffer_two_accounts: raw?.stock_buffer_two_accounts !== false,
    };
}

/**
 * Llave de idempotencia determinística orientada al artículo (y piezas de pack) en destino.
 * Si la publicación origen no está mapeada aún, usa su external_item_id origen.
 */
export function buildReplicationIdempotencyKey(params: {
    articulo_id?: string | null;
    cantidad_requerida?: number | null;
    source_item_id: string;
    target_marketplace_id: string;
}): string {
    const target = String(params.target_marketplace_id || '').trim();
    const art = params.articulo_id ? String(params.articulo_id).trim() : '';
    if (art) {
        const qty = Math.max(1, Number(params.cantidad_requerida || 1));
        return `art:${art}:q${qty}:dst:${target}`;
    }
    return `src:${String(params.source_item_id || '').trim()}:dst:${target}`;
}

/**
 * Recalcula contadores reales de un lote a partir de sus filas y aplica la condición
 * de parada explícita cuando pending + processing llega a 0.
 */
export async function syncReplicationBatchProgress(sb: any, batchId: string): Promise<{
    completed_count: number;
    waiting_optin_count: number;
    linked_existing_count: number;
    failed_count: number;
    skipped_count: number;
    pending_count: number;
    status: string;
} | null> {
    const [{ data: batch }, { data: items }] = await Promise.all([
        sb.from('replication_batches').select('id, status, finished_at').eq('id', batchId).maybeSingle(),
        sb.from('replication_batch_items').select('status').eq('batch_id', batchId),
    ]);
    if (!batch || !Array.isArray(items)) return null;

    let completed = 0;
    let waitingOptin = 0;
    let linkedExisting = 0;
    let failed = 0;
    let skipped = 0;
    let pending = 0;

    for (const row of items) {
        switch (row.status) {
            case 'completed':
                completed++;
                break;
            case 'waiting_optin':
                waitingOptin++;
                break;
            case 'linked_existing':
                linkedExisting++;
                break;
            case 'failed_validation':
            case 'failed_error':
            case 'optin_failed':
                failed++;
                break;
            case 'skipped':
            case 'cancelled':
            case 'paused_rollback':
            case 'rolled_back':
                skipped++;
                break;
            case 'pending':
            case 'processing':
            default:
                pending++;
                break;
        }
    }

    let nextStatus = batch.status;
    let finishedAt = batch.finished_at;
    if (batch.status === 'running' && pending === 0) {
        nextStatus = 'completed';
        finishedAt = finishedAt || new Date().toISOString();
    }

    await sb
        .from('replication_batches')
        .update({
            completed_count: completed,
            waiting_optin_count: waitingOptin,
            linked_existing_count: linkedExisting,
            failed_count: failed,
            skipped_count: skipped,
            status: nextStatus,
            updated_at: new Date().toISOString(),
            ...(finishedAt ? { finished_at: finishedAt } : {}),
        })
        .eq('id', batchId);

    return {
        completed_count: completed,
        waiting_optin_count: waitingOptin,
        linked_existing_count: linkedExisting,
        failed_count: failed,
        skipped_count: skipped,
        pending_count: pending,
        status: nextStatus,
    };
}
