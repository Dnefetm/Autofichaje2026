// Validación read-only del lote de sugerencias (señales fuertes) para la bandeja de triage.
// Credenciales: se leen de .env (gitignored), nunca hardcodeadas.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Falta NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env');
  process.exit(1);
}
const s = createClient(URL, KEY, { auth: { persistSession: false } });
const norm = (v) => (v || '').toLowerCase().replace(/\s+/g, ' ').trim();
const normCode = (v) => (v || '').replace(/[^0-9a-z]/gi, '').toLowerCase();

(async () => {
  // Muestra de 60 publicaciones sin mapear (tamaño de una página real)
  const { data: pubs, error } = await s.from('publicaciones_externas')
    .select('id, external_item_id, seller_sku, seller_custom_field, ean, gtin, upc, model, brand, id_producto_catalogo, par_item_id')
    .or('esta_mapeado.is.null,esta_mapeado.eq.false')
    .eq('external_variation_id', '0')
    .limit(60);
  if (error) { console.error('ERR', error.message); return; }

  // Índices de artículos por SKU/código/modelo (una sola pasada)
  const skus = new Set(); const codes = new Set(); const modelos = new Set();
  for (const p of pubs) {
    for (const x of [norm(p.seller_sku), norm(p.seller_custom_field)]) if (x) skus.add(x);
    for (const x of [normCode(p.ean), normCode(p.gtin), normCode(p.upc)]) if (x) codes.add(x);
    if (norm(p.model)) modelos.add(norm(p.model));
  }
  const skuArts = new Map(); const codeArts = new Map(); const modelArts = new Map();
  if (skus.size) {
    const parts = [...skus].flatMap((x) => [`articulo_id.eq.${x}`, `modelo.eq.${x}`]);
    const { data } = await s.from('articulos').select('articulo_id, nombre, marca, modelo, codigo_universal').or(parts.join(',')).limit(1000);
    for (const a of data || []) { skuArts.set(norm(a.articulo_id), a); skuArts.set(norm(a.modelo), a); }
  }
  if (codes.size) {
    const parts = [...codes].map((c) => `codigo_universal.eq.${c}`);
    const { data } = await s.from('articulos').select('articulo_id, nombre, marca, modelo, codigo_universal').or(parts.join(',')).limit(1000);
    for (const a of data || []) codeArts.set(normCode(a.codigo_universal), a);
  }
  if (modelos.size) {
    const parts = [...modelos].map((m) => `modelo.eq.${m}`);
    const { data } = await s.from('articulos').select('articulo_id, nombre, marca, modelo').or(parts.join(',')).limit(1000);
    for (const a of data || []) modelArts.set(norm(a.modelo), a);
  }

  let conSugerenciaFuerte = 0; let total = 0;
  for (const p of pubs) {
    total++;
    let hit = null;
    const sku = norm(p.seller_sku) || norm(p.seller_custom_field);
    if (sku && skuArts.has(sku)) hit = { score: 100, metodo: 'sku_exacto', a: skuArts.get(sku) };
    if (!hit) {
      const c = [normCode(p.ean), normCode(p.gtin), normCode(p.upc)].find((x) => x && codeArts.has(x));
      if (c) hit = { score: 100, metodo: 'codigo_exacto', a: codeArts.get(c) };
    }
    if (!hit) {
      const m = norm(p.model);
      if (m && modelArts.has(m)) {
        const a = modelArts.get(m);
        if (norm(p.brand) && norm(a.marca) === norm(p.brand)) hit = { score: 95, metodo: 'marca_modelo', a };
        else if (!norm(p.brand)) hit = { score: 80, metodo: 'modelo', a };
      }
    }
    if (hit && hit.score >= 95) conSugerenciaFuerte++;
  }

  console.log(`Muestra: ${total} publicaciones sin mapear`);
  console.log(`Con sugerencia fuerte (>=95%) lista para "Aceptar todas": ${conSugerenciaFuerte} (${Math.round((conSugerenciaFuerte / total) * 100)}%)`);
})();
