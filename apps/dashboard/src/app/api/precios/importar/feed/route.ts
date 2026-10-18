import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { friendlyError } from '@/lib/friendlyError';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/precios/importar/feed
 * { proveedor, tipo: 'existencias'|'sat', filas: FilaCanonica[], nombre? }
 *
 * Recibe las filas YA PARSEADAS EN EL NAVEGADOR (el navegador hace el parseo del archivo,
 * no Vercel) y hace el upsert set-based en catalogo_proveedor. No descarga ni parsea nada.
 */
export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    const proveedor = String(body?.proveedor ?? '').trim();
    const tipo = String(body?.tipo ?? '').trim();
    const filas = Array.isArray(body?.filas) ? body.filas : [];
    const nombre = String(body?.nombre ?? '').trim() || 'archivo.pdf';

    if (!proveedor) return NextResponse.json({ ok: false, error: 'proveedor requerido' }, { status: 400 });
    if (tipo !== 'existencias' && tipo !== 'sat') return NextResponse.json({ ok: false, error: 'tipo debe ser "existencias" o "sat"' }, { status: 400 });
    if (!filas.length) return NextResponse.json({ ok: false, error: 'No hay filas para procesar' }, { status: 400 });

    // Normalizar payload (solo los campos que el RPC necesita)
    const payload = filas.map((f: any) => ({
        proveedor: String(f.proveedor ?? proveedor),
        sku_norm: String(f.sku_norm ?? '').trim(),
        sku_proveedor: String(f.sku_proveedor ?? '').trim(),
        descripcion: f.descripcion ?? null,
        stock: f.stock ?? null,
        codigo_sat: f.codigo_sat ?? null,
    })).filter((f: any) => f.sku_norm);

    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('fn_upsert_catalogo_feed', {
        p_proveedor: proveedor,
        p_filas: payload,
        p_origen: tipo,
    });
    if (rpcErr) {
        return NextResponse.json({ ok: false, error: friendlyError(rpcErr) }, { status: 500 });
    }

    // Log ligero de feed
    await supabaseAdmin.from('proveedor_feeds_log').insert({
        proveedor,
        archivo: nombre,
        filas: payload.length,
    });

    return NextResponse.json({
        ok: true,
        proveedor,
        tipo,
        filas: payload.length,
        rpc: rpcData ?? null,
    });
}
