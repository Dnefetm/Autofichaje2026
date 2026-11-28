import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';
import { dispatchWorker } from '@/lib/dispatch-worker';
import { syncReplicationBatchProgress } from '@/lib/replication-batch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/catalog/replicar/batch/[id]
 * Retorna estado actualizado del lote y detalle por ítem para el Drawer Monitor.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        await syncReplicationBatchProgress(supabaseAdmin, id);

        const [{ data: batch, error: bErr }, { data: items, error: iErr }] = await Promise.all([
            supabaseAdmin.from('replication_batches').select('*').eq('id', id).maybeSingle(),
            supabaseAdmin
                .from('replication_batch_items')
                .select('*')
                .eq('batch_id', id)
                .order('created_at', { ascending: true }),
        ]);

        if (bErr || !batch) {
            return NextResponse.json({ ok: false, error: bErr?.message || 'Lote no encontrado' }, { status: 404 });
        }
        if (iErr) {
            return NextResponse.json({ ok: false, error: iErr.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true, batch, items: items || [] });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err?.message || 'Error consultando lote' }, { status: 500 });
    }
}

/**
 * POST /api/catalog/replicar/batch/[id]
 * Acciones de control y rollback sobre un lote:
 *  - pause_queue: detiene jobs pendientes y marca el lote en pausa
 *  - resume_queue: re-encola ítems pendientes y reactiva el worker
 *  - pause_live_listings: Nivel 1 — pausa cola + pausa publicaciones creadas en MeLi
 *  - rollback_close_and_unlink: Nivel 2 — cancela cola + cierra en MeLi + respalda en mapeo_desvinculados_log + desvincula
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const body = await req.json().catch(() => null);
        const action = String(body?.action || '').trim();

        const [{ data: batch, error: bErr }, { data: items }] = await Promise.all([
            supabaseAdmin.from('replication_batches').select('*').eq('id', id).maybeSingle(),
            supabaseAdmin.from('replication_batch_items').select('*').eq('batch_id', id),
        ]);

        if (bErr || !batch) {
            return NextResponse.json({ ok: false, error: 'Lote no encontrado' }, { status: 404 });
        }

        const batchItems = items || [];
        const pendingJobIds = batchItems.map((i: any) => i.job_id).filter(Boolean);

        if (action === 'pause_queue') {
            await supabaseAdmin
                .from('replication_batches')
                .update({ status: 'paused', updated_at: new Date().toISOString() })
                .eq('id', id);

            if (pendingJobIds.length > 0) {
                await supabaseAdmin
                    .from('jobs')
                    .update({ status: 'failed', error_log: 'Cola pausada por operador' })
                    .in('id', pendingJobIds)
                    .eq('status', 'pending');
            }

            await syncReplicationBatchProgress(supabaseAdmin, id);
            return NextResponse.json({ ok: true, action, status: 'paused' });
        }

        if (action === 'resume_queue') {
            const pendingItems = batchItems.filter((i: any) => i.status === 'pending');
            await supabaseAdmin
                .from('replication_batches')
                .update({ status: 'running', finished_at: null, updated_at: new Date().toISOString() })
                .eq('id', id);

            if (pendingItems.length > 0) {
                const nowIso = new Date().toISOString();
                const { data: newJobs } = await supabaseAdmin
                    .from('jobs')
                    .insert(
                        pendingItems.map((it: any) => ({
                            type: 'replicate_item',
                            payload: { batch_id: id, batch_item_id: it.id },
                            status: 'pending',
                            priority: 7,
                            max_attempts: 3,
                            scheduled_at: nowIso,
                        })),
                    )
                    .select('id, payload');

                if (newJobs && newJobs.length > 0) {
                    await Promise.all(
                        newJobs.map((j: any) =>
                            supabaseAdmin
                                .from('replication_batch_items')
                                .update({ job_id: j.id })
                                .eq('id', j.payload?.batch_item_id),
                        ),
                    );
                }
                dispatchWorker().catch(() => {});
            }

            await syncReplicationBatchProgress(supabaseAdmin, id);
            return NextResponse.json({ ok: true, action, resumed_items: pendingItems.length });
        }

        const meli = new MeliAdapter();

        if (action === 'pause_live_listings') {
            if (pendingJobIds.length > 0) {
                await supabaseAdmin
                    .from('jobs')
                    .update({ status: 'failed', error_log: 'Pausa Nivel 1 solicitada por operador' })
                    .in('id', pendingJobIds)
                    .eq('status', 'pending');
            }

            const createdItems = batchItems.filter(
                (i: any) => i.target_item_id && ['completed', 'waiting_optin', 'optin_failed'].includes(i.status),
            );
            const errors: string[] = [];
            let pausedCount = 0;

            for (const it of createdItems) {
                const targets = [it.target_item_id, it.target_catalog_item_id].filter(Boolean) as string[];
                let anyOk = false;
                for (const extId of targets) {
                    try {
                        await meli.pauseListing(batch.target_marketplace_id, extId);
                        await supabaseAdmin
                            .from('publicaciones_externas')
                            .update({ status_externo: 'paused', actualizado_el: new Date().toISOString() })
                            .eq('marketplace_id', batch.target_marketplace_id)
                            .eq('external_item_id', extId);
                        anyOk = true;
                    } catch (e: any) {
                        errors.push(`${extId}: ${e?.message || 'error pausando'}`);
                    }
                }
                if (anyOk) {
                    pausedCount++;
                    await supabaseAdmin
                        .from('replication_batch_items')
                        .update({ status: 'paused_rollback', updated_at: new Date().toISOString() })
                        .eq('id', it.id);
                }
            }

            await supabaseAdmin
                .from('replication_batches')
                .update({ status: 'paused', updated_at: new Date().toISOString() })
                .eq('id', id);

            await syncReplicationBatchProgress(supabaseAdmin, id);
            return NextResponse.json({ ok: true, action, paused_count: pausedCount, errors });
        }

        if (action === 'rollback_close_and_unlink') {
            if (pendingJobIds.length > 0) {
                await supabaseAdmin
                    .from('jobs')
                    .update({ status: 'failed', error_log: 'Rollback Nivel 2 ejecutado por operador' })
                    .in('id', pendingJobIds)
                    .eq('status', 'pending');
            }

            // Cerrar en MeLi únicamente las publicaciones NUEVAS creadas por este lote (nunca linked_existing)
            const createdItems = batchItems.filter(
                (i: any) =>
                    i.target_item_id &&
                    ['completed', 'waiting_optin', 'optin_failed', 'paused_rollback'].includes(i.status),
            );

            // Cancelar pendientes del mismo lote
            await supabaseAdmin
                .from('replication_batch_items')
                .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                .eq('batch_id', id)
                .in('status', ['pending', 'processing']);

            const errors: string[] = [];
            let rolledBackCount = 0;

            for (const it of createdItems) {
                const targets = [it.target_item_id, it.target_catalog_item_id].filter(Boolean) as string[];
                for (const extId of targets) {
                    // Primero cancelar cualquier catalog_optin pendiente de este ítem
                    await supabaseAdmin
                        .from('jobs')
                        .update({ status: 'failed', error_log: 'Cancelado por rollback de lote' })
                        .eq('type', 'catalog_optin')
                        .eq('status', 'pending')
                        .contains('payload', { item_id: extId });

                    try {
                        await meli.closeListing(batch.target_marketplace_id, extId);
                    } catch (e: any) {
                        const msg = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || 'error cerrando');
                        errors.push(`${extId}: ${msg}`);
                    }
                }

                if (targets.length > 0) {
                    const { data: pubRows } = await supabaseAdmin
                        .from('publicaciones_externas')
                        .select('id, external_item_id, titulo, status_externo, sub_status')
                        .eq('marketplace_id', batch.target_marketplace_id)
                        .in('external_item_id', targets);

                    const pubIds = (pubRows || []).map((r: any) => r.id);
                    if (pubIds.length > 0) {
                        const pubById = new Map((pubRows || []).map((r: any) => [r.id, r]));
                        const { data: mapeos } = await supabaseAdmin
                            .from('mapeo_publicacion_articulo')
                            .select('id, publicacion_id, articulo_id, cantidad_requerida, sincronizar_stock')
                            .in('publicacion_id', pubIds);

                        let backupOk = true;
                        if (mapeos && mapeos.length > 0) {
                            const backupRows = mapeos.map((m: any) => {
                                const p = pubById.get(m.publicacion_id);
                                return {
                                    publicacion_id: m.publicacion_id,
                                    external_item_id: p?.external_item_id ?? it.target_item_id,
                                    articulo_id: m.articulo_id,
                                    cantidad_requerida: m.cantidad_requerida,
                                    sincronizar_stock: m.sincronizar_stock,
                                    motivo: 'rollback_lote_masivo',
                                    mapeo_id: m.id,
                                    titulo: p?.titulo ?? it.applied_title ?? null,
                                    status_externo: 'closed',
                                    sub_status: p?.sub_status ?? null,
                                    usuario_o_proceso: 'replicar_batch_rollback',
                                    metadata: { batch_id: id, batch_item_id: it.id },
                                };
                            });
                            const { error: logErr } = await supabaseAdmin
                                .from('mapeo_desvinculados_log')
                                .insert(backupRows);
                            if (logErr) {
                                backupOk = false;
                                errors.push(`backup mapeo ${it.target_item_id}: ${logErr.message}`);
                            }
                        }

                        if (backupOk) {
                            if (mapeos && mapeos.length > 0) {
                                await supabaseAdmin
                                    .from('mapeo_publicacion_articulo')
                                    .delete()
                                    .in('publicacion_id', pubIds);
                            }
                            await supabaseAdmin
                                .from('publicaciones_externas')
                                .update({
                                    status_externo: 'closed',
                                    esta_mapeado: false,
                                    actualizado_el: new Date().toISOString(),
                                })
                                .in('id', pubIds);
                        }
                    }
                }

                rolledBackCount++;
                await supabaseAdmin
                    .from('replication_batch_items')
                    .update({ status: 'rolled_back', updated_at: new Date().toISOString() })
                    .eq('id', it.id);
            }

            await supabaseAdmin
                .from('replication_batches')
                .update({
                    status: 'rolled_back',
                    finished_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq('id', id);

            await syncReplicationBatchProgress(supabaseAdmin, id);
            return NextResponse.json({ ok: true, action, rolled_back_count: rolledBackCount, errors });
        }

        return NextResponse.json({ ok: false, error: `Acción no soportada: ${action}` }, { status: 400 });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err?.message || 'Error ejecutando acción sobre lote' }, { status: 500 });
    }
}
