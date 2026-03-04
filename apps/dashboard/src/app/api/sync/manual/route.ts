import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: Request) {
    try {
        // En un caso real podríamos requerir auth, pero como es mitigación rápida de emergencia
        // buscaremos todas las cuentas configuradas y despacharemos el worker

        const { data: configs, error: configError } = await supabaseAdmin
            .from('marketplace_configs')
            .select('id, account_name')
            .eq('is_active', true);

        if (configError) throw configError;

        if (!configs || configs.length === 0) {
            return NextResponse.json({ message: 'No hay tiendas vinculadas' }, { status: 400 });
        }

        const jobs = configs.map(c => ({
            type: 'sync_account_catalog',
            payload: { marketplace_id: c.id },
            status: 'pending',
            scheduled_at: new Date().toISOString()
        }));

        const { error: jobsError } = await supabaseAdmin.from('jobs').insert(jobs);

        if (jobsError) throw jobsError;

        return NextResponse.json({ message: 'Sincronización forzada encolada con éxito', count: jobs.length });
    } catch (error: any) {
        console.error('API Manual Sync Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
