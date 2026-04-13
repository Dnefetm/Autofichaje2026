import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * GET  /api/settings/webhook  — devuelve config + métricas del buffer
 * POST /api/settings/webhook  — actualiza ventanas por topic
 */

export async function GET() {
    try {
        // Config de topics
        const { data: configs, error: cfgErr } = await supabaseAdmin
            .from('webhook_config')
            .select('*')
            .order('topic');

        if (cfgErr) throw cfgErr;

        // Métricas del buffer: eventos por topic en las últimas 24h
        const { data: metrics } = await supabaseAdmin
            .from('webhook_buffer')
            .select('topic, status, repeat_count, last_seen_at, priority')
            .gte('last_seen_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .order('last_seen_at', { ascending: false });

        // Agregar métricas por topic
        const metricsByTopic: Record<string, {
            total_events: number;
            pending: number;
            done: number;
            repeat_count_total: number;
            last_seen_at: string | null;
        }> = {};

        for (const row of (metrics || [])) {
            if (!metricsByTopic[row.topic]) {
                metricsByTopic[row.topic] = {
                    total_events: 0, pending: 0, done: 0,
                    repeat_count_total: 0, last_seen_at: null,
                };
            }
            const m = metricsByTopic[row.topic];
            m.total_events++;
            m.repeat_count_total += row.repeat_count ?? 1;
            if (row.status === 'pending') m.pending++;
            else m.done++;
            if (!m.last_seen_at || row.last_seen_at > m.last_seen_at) {
                m.last_seen_at = row.last_seen_at;
            }
        }

        // Jobs evitados = repeat_count_total - total_events (notificaciones que no generaron job nuevo)
        const topicMetrics = Object.entries(metricsByTopic).map(([topic, m]) => ({
            topic,
            ...m,
            jobs_evitados: m.repeat_count_total - m.total_events,
        }));

        // Jobs pendientes en cola (las últimas 6h) agrupados por tipo
        const { data: pendingJobs } = await supabaseAdmin
            .from('jobs')
            .select('type, status, priority, scheduled_at')
            .in('status', ['pending', 'processing'])
            .gte('created_at', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString());

        const jobsByType: Record<string, number> = {};
        for (const j of (pendingJobs || [])) {
            jobsByType[j.type] = (jobsByType[j.type] ?? 0) + 1;
        }

        return NextResponse.json({
            configs: configs || [],
            metrics: topicMetrics,
            jobs_en_cola: jobsByType,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { topic, window_seconds, dispatch_immediate, enabled } = body;

        if (!topic) {
            return NextResponse.json({ error: 'topic requerido' }, { status: 400 });
        }

        if (window_seconds !== undefined && (window_seconds < 0 || window_seconds > 1800)) {
            return NextResponse.json({ error: 'window_seconds debe estar entre 0 y 1800 segundos (30 min)' }, { status: 400 });
        }

        const update: any = { updated_at: new Date().toISOString() };
        if (window_seconds !== undefined) update.window_seconds = window_seconds;
        if (dispatch_immediate !== undefined) update.dispatch_immediate = dispatch_immediate;
        if (enabled !== undefined) update.enabled = enabled;

        const { data, error } = await supabaseAdmin
            .from('webhook_config')
            .upsert({ topic, ...update }, { onConflict: 'topic' })
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ ok: true, config: data });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
