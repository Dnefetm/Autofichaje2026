import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { friendlyError } from '@/lib/friendlyError';
import { obtenerAdapter, mergeFilas } from '@/lib/proveedor-adapter';
import { registrarAdaptadoresProveedores } from '@/lib/adapters';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Idempotente: registra Urrea + Wurth (y futuros proveedores).
registrarAdaptadoresProveedores();

/**
 * POST /api/precios/importar/feed-pdf
 * { proveedor, tipo: 'existencias'|'sat', storage_path, bucket?, nombre? }
 * Descarga el PDF desde Storage, lo parsea con el adapter del proveedor y hace
 * upsert en catalogo_proveedor (stock o codigo_sat) sin sobrescribir sku_proveedor.
 */
export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    const proveedorRaw = String(body?.proveedor ?? '').trim();
    const tipo = String(body?.tipo ?? '').trim();
    const storagePath = String(body?.storage_path ?? '').trim();
    const bucket = String(body?.bucket ?? 'excel-precios').trim();
    const nombre = String(body?.nombre ?? '').trim() || storagePath.split('/').pop() || 'archivo.pdf';

    if (!proveedorRaw) return NextResponse.json({ ok: false, error: 'proveedor requerido' }, { status: 400 });
    if (tipo !== 'existencias' && tipo !== 'sat') return NextResponse.json({ ok: false, error: 'tipo debe ser "existencias" o "sat"' }, { status: 400 });
    if (!storagePath) return NextResponse.json({ ok: false, error: 'storage_path requerido' }, { status: 400 });

    const adapter = obtenerAdapter(proveedorRaw);
    if (!adapter) {
        return NextResponse.json({ ok: false, error: `No hay adapter para el proveedor "${proveedorRaw}"` }, { status: 400 });
    }
    const proveedor = adapter.nombre; // nombre canónico del adapter (consistente con el parseo)

    // Descargar PDF desde Storage
    const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(bucket).download(storagePath);
    if (dlErr || !blob) {
        return NextResponse.json({ ok: false, error: friendlyError(dlErr) || 'No se pudo descargar el archivo' }, { status: 404 });
    }
    const buffer = Buffer.from(await blob.arrayBuffer());

    // Parsear con el adapter (feed indica existencias vs sat)
    const filas = await adapter.parse({ nombre, buffer, tipo: 'pdf', feed: tipo });
    if (!filas.length) {
        return NextResponse.json({ ok: false, error: 'No se extrajeron filas del archivo' }, { status: 400 });
    }

    // Merge por (proveedor, sku_norm); stock se sobrescribe con el valor más reciente
    const merged = mergeFilas(filas);
    const payload = [...merged.values()].map((f) => ({
        proveedor: f.proveedor,
        sku_norm: f.sku_norm,
        sku_proveedor: f.sku_proveedor,
        descripcion: f.descripcion ?? null,
        stock: f.stock ?? null,
        codigo_sat: f.codigo_sat ?? null,
    }));

    // Upsert set-based (una sola llamada RPC)
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
        filas: merged.size,
    });

    return NextResponse.json({
        ok: true,
        proveedor,
        tipo,
        filas: merged.size,
        rpc: rpcData ?? null,
    });
}
