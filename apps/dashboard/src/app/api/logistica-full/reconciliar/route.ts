import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/logistica-full/reconciliar — reconciliación de "en camino" contra MeLi.
// Lee INBOUND_RECEPTION por inventory_id, casa inbound_id ↔ guía del egreso, y marca
// los egresos recibidos como 'recibido' (salen de "en camino"). Es el "polling" manual.
export async function POST(_req: Request) {
    try {
        const meli = new MeliAdapter();

        // 1. Egresos activos (declarados, no recibidos ni cancelados).
        const { data: activos } = await supabaseAdmin
            .from('egresos')
            .select('guia, codigo_ml')
            .eq('tipo_egreso', 'envio_full')
            .eq('estado_envio', 'en_camino');
        if (!activos || activos.length === 0) {
            return NextResponse.json({ success: true, reconciliados: 0, message: 'sin egresos en camino' });
        }

        // 2. marketplace_id por inventory_id (para el token de cada cuenta).
        const codigos = [...new Set(activos.map((a: any) => a.codigo_ml).filter(Boolean))] as string[];
        const mkPorCodigo = new Map<string, string>();
        for (let i = 0; i < codigos.length; i += 100) {
            const chunk = codigos.slice(i, i + 100);
            const { data: pubs } = await supabaseAdmin
                .from('publicaciones_externas')
                .select('inventory_id, marketplace_id')
                .in('inventory_id', chunk)
                .eq('logistic_type', 'fulfillment');
            for (const p of (pubs || [])) {
                if (!mkPorCodigo.has(p.inventory_id)) mkPorCodigo.set(p.inventory_id, p.marketplace_id);
            }
        }

        // 3. Por cada inventory_id, traer INBOUND_RECEPTION y casar inbound_id ↔ guía.
        //    PENDIENTE DE VALIDAR en vivo: que inbound_id de MeLi == número de "Envío #" del PDF.
        const guiasRecibidas = new Set<string>();
        for (const codigo of codigos) {
            const mk = mkPorCodigo.get(codigo);
            if (!mk) continue;
            const ops = await meli.syncFullOperations(mk, codigo, { type: 'INBOUND_RECEPTION' });
            for (const op of ops) {
                const ref = (op.external_references || []).find((r: any) => r.type === 'inbound_id');
                const inboundId = ref?.value != null ? String(ref.value).trim() : null;
                if (!inboundId) continue;
                for (const a of activos) {
                    if (a.guia && String(a.guia).trim() === inboundId) guiasRecibidas.add(a.guia);
                }
            }
        }

        // 4. Marcar recibidos.
        let reconciliados = 0;
        const guias = [...guiasRecibidas];
        for (const g of guias) {
            const { data: upd } = await supabaseAdmin
                .from('egresos')
                .update({ estado_envio: 'recibido' })
                .eq('tipo_egreso', 'envio_full')
                .eq('guia', g)
                .eq('estado_envio', 'en_camino')
                .select('egreso_id');
            reconciliados += (upd || []).length;
        }

        return NextResponse.json({ success: true, guias_recibidas: guias, reconciliados });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error reconciliando' }, { status: 500 });
    }
}
