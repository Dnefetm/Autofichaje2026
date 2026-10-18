import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { friendlyError } from '@/lib/friendlyError';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { proveedor, fileName } = await req.json();
  if (!proveedor || !fileName) {
    return NextResponse.json({ ok: false, error: 'proveedor y fileName requeridos' }, { status: 400 });
  }
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (!ext || !['xlsx', 'xls'].includes(ext)) {
    return NextResponse.json({ ok: false, error: 'Solo .xlsx o .xls' }, { status: 400 });
  }

  const BUCKET = 'excel-precios';
  // Asegurar bucket privado
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  if (!buckets?.some(b => b.name === BUCKET)) {
    await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
  }

  // Supabase Storage rechaza claves con espacios o caracteres no-ASCII (acentos, ñ).
  // Sanitizar proveedor y nombre de archivo: quitar acentos y dejar solo [a-z0-9._-].
  const sanitizeKey = (s: string) => s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_{2,}/g, '_');

  const path = `${sanitizeKey(proveedor)}/${Date.now()}_${sanitizeKey(fileName)}`;
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    return NextResponse.json({ ok: false, error: friendlyError(error) }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    bucket: BUCKET,
    path: data.path,
    token: data.token,
    signedUrl: data.signedUrl,
  });
}
