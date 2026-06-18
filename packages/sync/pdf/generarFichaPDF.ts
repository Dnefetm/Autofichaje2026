import { renderToBuffer } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { FichaTecnicaPDF, FichaPDFData, FichaPDFMeta } from './FichaTecnicaPDF';

const COLS = `
  id, nombre_producto, descripcion, descripcion_larga, fabricante, especificaciones,
  uso_recomendado, precauciones, ingredientes, bullet_points, palabras_clave,
  atributos_dinamicos, marca, marca_id, modelo, variante, codigo_universal,
  categoria, materiales, peso_kg, largo_cm, ancho_cm, alto_cm,
  informacion_normativa, instrucciones_uso, leyendas_precautorias, indicaciones_almacenamiento
`;

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

const BRAND_COLORS: Record<string, string> = {
  'Würth': '#C8102E', 'W-Max': '#0F4C81', 'W-Max By Würth': '#C8102E',
  'Urrea': '#E30613', 'Surtek': '#F39200',
};

/** Convierte cualquier imagen (incl. WebP/AVIF, no soportados por react-pdf) a un data URL PNG. */
async function toPdfDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const png = await sharp(buf).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Genera el PDF de una ficha publicada, lo sube a storage y devuelve la URL pública. */
export async function generarFichaPDF(fichaId: string, baseUrl: string) {
  const supabase = admin();

  // 1. Cargar ficha + nombre canónico de marca
  const { data: ficha, error } = await supabase
    .from('fichas_tecnicas')
    .select(`${COLS}, marcas:marca_id ( nombre )`)
    .eq('id', fichaId)
    .single();
  if (error || !ficha) throw new Error('Ficha no encontrada');

  // 2. Versionado: contar PDFs previos de este SKU
  const sku = (ficha as any).codigo_universal || fichaId;
  const { count } = await supabase
    .from('ficha_pdfs')
    .select('id', { count: 'exact', head: true })
    .eq('ficha_tecnica_id', fichaId);
  const version = (count ?? 0) || 1;

  // 3. QR a la URL pública
  const urlPublica = `${baseUrl}/fichas/${fichaId}`;
  const qrDataUrl = await QRCode.toDataURL(urlPublica, { margin: 0, width: 120 });

  // 3b. Imagenes del producto (orden asc) -> convertir a PNG data URL (react-pdf no soporta WebP)
  const { data: imgs } = await supabase
    .from('ficha_imagenes')
    .select('url, orden')
    .eq('ficha_id', fichaId)
    .order('orden', { ascending: true });
  const imagenUrls = (
    await Promise.all((imgs || []).map((r: any) => toPdfDataUrl(r.url)))
  ).filter((x): x is string => !!x);

  const data: FichaPDFData = {
    ...(ficha as any),
    marca_nombre: (ficha as any).marcas?.nombre ?? (ficha as any).marca,
    imagen_urls: imagenUrls,
  };
  const marcaNombre = data.marca_nombre || data.marca || '';
  const meta: FichaPDFMeta = {
    version,
    generadoEn: new Date().toISOString(),
    urlPublica,
    qrDataUrl,
    brandColor: BRAND_COLORS[marcaNombre] || '#C8102E',
  };

  // 4. Render -> Buffer
  const buffer = await renderToBuffer(FichaTecnicaPDF({ ficha: data, meta }) as any);

  // 5. Subir a storage con nombre SKU_vN.pdf
  const path = `fichas/${fichaId}/${String(sku).replace(/[^\w.-]/g, '_')}_v${version}.pdf`;
  const { error: upErr } = await supabase.storage
    .from('fichas-pdf')
    .upload(path, buffer, { contentType: 'application/pdf', upsert: true });
  if (upErr) throw new Error(`Error subiendo PDF: ${upErr.message}`);
  const { data: pub } = supabase.storage.from('fichas-pdf').getPublicUrl(path);

  // 6. Registrar versión
  await supabase.from('ficha_pdfs').upsert({
    ficha_tecnica_id: fichaId,
    version,
    storage_path: path,
    url_publica: pub.publicUrl,
    generado_en: meta.generadoEn,
  }, { onConflict: 'ficha_tecnica_id,version' });

  return { ok: true, version, path, url: pub.publicUrl, bytes: buffer.length };
}
