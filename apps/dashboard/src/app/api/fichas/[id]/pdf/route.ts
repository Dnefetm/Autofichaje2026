import { NextRequest, NextResponse } from 'next/server';
import { generarFichaPDF } from '@gestor/sync/pdf/generarFichaPDF';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'fichaId requerido' }, { status: 400 });
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
    const result = await generarFichaPDF(id, baseUrl);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Error generando PDF' }, { status: 500 });
  }
}
