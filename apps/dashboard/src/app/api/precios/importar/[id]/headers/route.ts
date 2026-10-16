import { friendlyError } from '@/lib/friendlyError';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await props.params;

        const { data: imp, error } = await supabaseAdmin
            .from('importaciones_excel')
            .select('mapeo_columnas, proveedor, estado')
            .eq('id', id)
            .single();

        if (error || !imp) {
            return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 });
        }

        const m: any = imp.mapeo_columnas || {};
        const path = m._storage_path;
        const bucket = m._bucket ?? 'excel-precios';

        if (!path) {
            return NextResponse.json({ ok: false, error: 'No hay archivo asociado a esta importación' }, { status: 400 });
        }

        // Leer de la tabla raw (ya parseada header-agnóstica por letra de columna)
        const { data: rawRows } = await supabaseAdmin
            .from('listas_precios_raw')
            .select('payload')
            .eq('importacion_id', id)
            .order('fila_num', { ascending: true })
            .limit(1000);

        let headers: string[] = [];
        let headerLabels: Record<string, string> = {};
        let preview: string[][] = [];
        if (rawRows && rawRows.length > 0) {
            headers = Object.keys((rawRows[0].payload as Record<string, any>) || {});
            const headerRow = rawRows.find(r => Object.values((r.payload as Record<string, any>) || {}).some((v: any) => /precio|codigo|descrip|aplicaci/i.test(String(v ?? ''))));
            if (headerRow) headerLabels = (headerRow.payload as Record<string, string>) || {};
            preview = rawRows.slice(0, 4).map(r => headers.map(h => ((r.payload as Record<string, any>) || {})[h] ?? ''));
        }

        return NextResponse.json({ ok: true, headers, preview, header_labels: headerLabels, mapeo_actual: m });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: friendlyError(err) }, { status: 500 });
    }
}
