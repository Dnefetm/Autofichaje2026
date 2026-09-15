import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// T1 Logística Full — sincroniza el stock del depósito Full de MeLi hacia
// publicaciones_externas.stock_full (por inventory_id único).
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

        const meli = new MeliAdapter();
        const results: { accountId: string; updated: number; errors: number }[] = [];
        for (const acc of accounts) {
            const r = await meli.syncFullStock(acc.id);
            results.push({ accountId: acc.id, ...r });
        }

        return NextResponse.json({ success: true, results });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error sincronizando stock Full' }, { status: 500 });
    }
}
