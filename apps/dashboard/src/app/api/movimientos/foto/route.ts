import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Fotos de movimientos — subida directa cliente->Storage SIN pasar bytes por Vercel.
//
// Seguridad: bucket PRIVADO `movimientos-fotos`. El navegador comprime a WebP en
// Canvas (máx 1280px, ~150KB) y sube directo con un signed upload URL. Para ver la
// foto se pide un signed read URL de corta duración. Nada público, sin CPU de servidor.
const BUCKET = 'movimientos-fotos';
const READ_URL_TTL = 3600; // 1 hora

async function ensureBucket() {
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    if (!buckets?.some((b: any) => b.name === BUCKET)) {
        await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
    }
}

// POST — devuelve un signed upload URL + path para subir una foto directo.
// body: { ext: 'webp'|'jpg'|... }  (opcional, default 'webp')
export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const ext = String(body?.ext || 'webp').toLowerCase().replace(/[^a-z0-9]/g, '') || 'webp';

        await ensureBucket();

        // Path no adivinable, sin datos del movimiento en el nombre (privacidad).
        const path = `movimientos/${crypto.randomUUID()}.${ext}`;
        const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path);
        if (error || !data) return NextResponse.json({ ok: false, error: error?.message || 'no signed url' }, { status: 500 });

        return NextResponse.json({ ok: true, bucket: BUCKET, path: data.path, token: data.token });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err?.message || 'error' }, { status: 500 });
    }
}

// GET /api/movimientos/foto?path=... — signed read URL de corta duración.
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const path = searchParams.get('path');
        if (!path) return NextResponse.json({ ok: false, error: 'path requerido' }, { status: 400 });

        const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, READ_URL_TTL);
        if (error || !data?.signedUrl) return NextResponse.json({ ok: false, error: error?.message || 'no signed url' }, { status: 500 });

        return NextResponse.json({ ok: true, url: data.signedUrl });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err?.message || 'error' }, { status: 500 });
    }
}
