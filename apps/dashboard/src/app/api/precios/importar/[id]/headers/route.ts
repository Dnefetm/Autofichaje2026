import { friendlyError } from '@/lib/friendlyError';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import * as XLSX from 'xlsx';

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

        const { data: file } = await supabaseAdmin.storage.from(bucket).download(path);
        
        if (!file) {
            return NextResponse.json({ ok: false, error: 'No se pudo descargar el Excel desde Storage' }, { status: 404 });
        }

        const buf = new Uint8Array(await file.arrayBuffer());
        const wb = XLSX.read(buf, { type: 'buffer', dense: true, sheetRows: 6 });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        const headers: string[] = (rows[0] ?? []).map(String);
        // Muestra de las primeras filas para vista previa (ignoramos la fila 0 que es el header)
        const preview = rows.slice(1, 4).map(r => r.map((v: any) => String(v ?? '')));

        return NextResponse.json({ ok: true, headers, preview, mapeo_actual: m });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: friendlyError(err) }, { status: 500 });
    }
}
