import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// T1 Logística Full — sincroniza el stock del depósito Full (stock_full) y los
// datos de replenishment (sugerencia ML, urgencia, ventas 30d) hacia publicaciones_externas.
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
        const results: { accountId: string; stock: { updated: number; errors: number }; replenishment: { updated: number; errors: number } }[] = [];
        for (const acc of accounts) {
            const stock = await meli.syncFullStock(acc.id);
            let replenishment = { updated: 0, errors: 0 };
            try {
                replenishment = await meli.syncReplenishment(acc.id);
            } catch (e: any) {
                // Si la migración de columnas aún no está aplicada, no romper el sync de stock.
                replenishment = { updated: 0, errors: 1 };
            }
            results.push({ accountId: acc.id, stock, replenishment });
        }

        return NextResponse.json({ success: true, results });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error sincronizando stock Full' }, { status: 500 });
    }
}
