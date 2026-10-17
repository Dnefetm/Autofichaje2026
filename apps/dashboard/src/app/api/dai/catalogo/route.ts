import { NextRequest, NextResponse } from 'next/server';
import { extraerProductoDai } from '@/lib/dai-extractor';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/dai/catalogo?codigo=<numero DAI>
 * Devuelve el producto exacto de dai.com.mx (foto + aplicaciones vehiculares).
 */
export async function GET(req: NextRequest) {
    const codigo = req.nextUrl.searchParams.get('codigo') || '';
    if (!codigo) return NextResponse.json({ ok: false, error: 'codigo requerido' }, { status: 400 });

    try {
        const producto = await extraerProductoDai(codigo);
        return NextResponse.json({ ok: true, producto });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
    }
}
