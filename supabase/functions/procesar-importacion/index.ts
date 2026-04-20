import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import ExcelJS from 'npm:exceljs@4.4.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CHUNK = 500;

// Setup single Supabase instance
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function heartbeat(id: string, procesadas: number) {
  await sb.from('importaciones_excel')
    .update({ filas_procesadas: procesadas, ultima_actividad: new Date().toISOString() })
    .eq('id', id);
}

async function pickNext(): Promise<string | null> {
  const { data } = await sb.rpc('fn_claim_next_importacion');
  return (data as string) ?? null;
}

async function procesar(importacionId: string) {
  const { data: imp } = await sb.from('importaciones_excel').select('*').eq('id', importacionId).single();
  if (!imp) return;

  const m = imp.mapeo_columnas;
  const path = m._storage_path;
  const bucket = m._bucket ?? 'excel-precios';
  const { data: file } = await sb.storage.from(bucket).download(path);
  if (!file) throw new Error('No se pudo descargar Excel asociado a la importación');

  // Stream parsing setup
  const buf = new Uint8Array(await file.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheet = wb.worksheets[0];

  const headers: string[] = [];
  const filas: any[] = [];
  let total = 0;
  
  sheet.eachRow((row, i) => {
    const vals = (row.values as any[]).slice(1).map((v: any) => v?.result ?? v?.text ?? v ?? '');
    if (i === 1) { 
       headers.push(...vals.map(String)); 
       return; 
    }
    const byHeader: Record<string, string> = {};
    headers.forEach((h, idx) => byHeader[h] = String(vals[idx] ?? '').trim());
    
    const modelo = byHeader[m.columna_modelo] ?? '';
    const marca  = byHeader[m.columna_marca]  ?? '';
    
    // Ignorar si no hay modelo ni marca básicos
    if (!modelo && !marca) return;
    
    const codigo = m.columna_codigo ? (byHeader[m.columna_codigo] || null) : null;
    const desc   = m.columna_descripcion ? (byHeader[m.columna_descripcion] || null) : null;
    const moneda = m.columna_moneda ? (byHeader[m.columna_moneda] || m.moneda_default || 'MXN') : (m.moneda_default || 'MXN');
    const precios: Record<string, number> = {};
    
    for (const p of m.precios) {
      const raw = (byHeader[p.columna] ?? '').replace(/[^0-9.]/g, '');
      const n = parseFloat(raw);
      if (!isNaN(n) && n > 0) precios[p.columna] = n;
    }
    if (Object.keys(precios).length === 0) return;
    
    filas.push({ rowIndex: i, modelo, marca, codigo, descripcion: desc, moneda, precios });
    total++;
  });

  await sb.from('importaciones_excel').update({ total_filas: total }).eq('id', importacionId);

  let procesadas = 0;
  let conMatch = 0;
  
  for (let off = 0; off < filas.length; off += CHUNK) {
    const slice = filas.slice(off, off + CHUNK);

    const matchesArray = await Promise.all(slice.map(f =>
      sb.rpc('fn_match_articulo_proveedor', { p_modelo: f.modelo || null, p_marca: f.marca || null, p_codigo: f.codigo || null })
        .then(r => r.data ?? [])
    ));

    const inserts: any[] = [];
    slice.forEach((f, idx) => {
      const candArray = matchesArray[idx];
      const mt = candArray[0] ?? null;
      const nivel = mt?.nivel_match ?? 'nuevo';
      let estadoMatch = 'sin_match';
      
      if (nivel === 'actualizado_fuerte' || nivel === 'match_exacto') estadoMatch = 'match_exacto';
      else if (['cambio_codigo_sugerido', 'ambiguo', 'match_similitud'].includes(nivel)) estadoMatch = 'match_similitud';
      
      if (estadoMatch !== 'sin_match') conMatch++;
      
      for (const p of m.precios) {
        const valor = f.precios[p.columna];
        if (!valor) continue;
        
        inserts.push({
          importacion_id: importacionId,
          articulo_id: null,
          articulo_sugerido_id: mt?.articulo_id ?? null,
          modelo_excel: f.modelo, 
          marca_excel: f.marca,
          codigo_universal_excel: f.codigo, 
          descripcion_excel: f.descripcion, 
          nombre_excel: f.descripcion,
          tipo_costo: p.tipo_costo, 
          valor, 
          moneda: f.moneda,
          fuente: 'excel',
          puntaje_match: mt?.puntaje_match ?? null,
          estado_match: estadoMatch, 
          vigente: false,
          candidatos_jsonb: candArray.length > 0 ? candArray : [],
          incluye_iva: p.incluye_iva ?? false,
        });
      }
    });

    if (inserts.length > 0) {
      const { error } = await sb.from('costos_articulo').insert(inserts);
      if (error) throw new Error(`Fallo en bloque ${off}: ${error.message}`);
    }
    
    procesadas += slice.length;
    await heartbeat(importacionId, procesadas);
  }

  await sb.from('importaciones_excel').update({
    filas_con_match: conMatch,
    estado: 'en_revision',
    ultima_actividad: new Date().toISOString(),
  }).eq('id', importacionId);
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok');

  try {
    for (let i = 0; i < 5; i++) {
      const id = await pickNext();
      if (!id) break;
      
      try { 
        await procesar(id); 
      }
      catch (e: any) {
        await sb.from('importaciones_excel').update({
          estado: 'error', 
          error_mensaje: String(e?.message ?? e),
          ultima_actividad: new Date().toISOString(),
        }).eq('id', id);
      }
    }
    return new Response(JSON.stringify({ ok: true }), { headers: {'Content-Type': 'application/json'} });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), { status: 500, headers: {'Content-Type': 'application/json'} });
  }
});
