import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { dispatchWorker } from '@/lib/dispatch-worker';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// POST /api/logistica-full/sync — dispara el sync de catálogo RESUMIBLE (sync_account_catalog),
// que ahora trae en un solo paso: catálogo + aptas (stock_full) + en camino (stock_full_total
// vía replenishment). Ya no hace la sincronización inline (que moría por timeout a los 60s).
export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const accountId = body.accountId as string | undefined;

        let accounts: { id: string }[] = [];
        if (accountId) {
            accounts = [{ id: accountId }];
        } else {
            const { data } = await supabaseAdmin
                .from('marketplace_configs')
                .select('id')
                .eq('is_active', true);
            accounts = (data || []) as { id: string }[];
        }

        if (accounts.length === 0) {
            return NextResponse.json({ success: false, error: 'No hay cuentas activas' }, { status: 400 });
        }

        let encolados = 0;
        for (const acc of accounts) {
            const { error } = await supabaseAdmin.from('jobs').insert({
                type: 'sync_account_catalog',
                payload: { marketplace_id: acc.id },
                status: 'pending',
                priority: 2,
                scheduled_at: new Date().toISOString(),
            });
            if (!error) encolados++;
        }

        await dispatchWorker().catch(() => {});
        return NextResponse.json({ success: true, encolados });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error encolando sync' }, { status: 500 });
    }
}
