import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';

export const dynamic = 'force-dynamic';

// Ruta B (enriquecimiento decorativo bajo demanda): la UI llama a este endpoint
// al abrir la ficha para rellenar los campos decorativos que la Ruta A ya no sincroniza
// en el multiGET frecuente (fotos, campañas, dimensiones, garantía, etc.).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const { data: pub } = await supabaseAdmin
            .from('publicaciones_externas')
            .select('marketplace_id, external_item_id')
            .eq('id', id)
            .single();

        if (!pub || !pub.external_item_id || !pub.marketplace_id) {
            return NextResponse.json({ ok: false, error: 'publicacion sin item MeLi' });
        }

        const adapter = new MeliAdapter();
        const enriched = await adapter.enrichDecorativeFields(pub.marketplace_id, pub.external_item_id);
        return NextResponse.json({ ok: true, ...enriched });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || String(e) });
    }
}
