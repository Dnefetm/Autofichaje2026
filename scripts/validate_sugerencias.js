// Valida la lógica del motor de sugerencias contra producción (solo lectura).
// Replica las mismas señales de lib/vinculacion/sugerencias.ts sobre datos reales.
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

function dice(a, b) {
  if (!a || !b) return 0;
  const al = a.toLowerCase().trim(), bl = b.toLowerCase().trim();
  if (al === bl) return 1;
  if (al.length < 2 || bl.length < 2) return 0;
  const m = new Map();
  for (let i = 0; i < al.length - 1; i++) { const bi = al.slice(i, i + 2); m.set(bi, (m.get(bi) || 0) + 1); }
  let inter = 0;
  for (let i = 0; i < bl.length - 1; i++) { const bi = bl.slice(i, i + 2); const c = m.get(bi) || 0; if (c > 0) { m.set(bi, c - 1); inter++; } }
  return (2 * inter) / (al.length - 1 + bl.length - 1);
}

(async () => {
  // 10 publicaciones sin mapear, priorizando las que tengan señales útiles
  const { data: pubs, error } = await s
    .from('publicaciones_externas')
    .select('id, external_item_id, titulo, brand, model, seller_sku, seller_custom_field, ean, gtin, upc, id_producto_catalogo, par_item_id')
    .or('esta_mapeado.is.null,esta_mapeado.eq.false')
    .eq('external_variation_id', '0')
    .not('seller_sku', 'is', null)
    .limit(10);

  if (error) { console.error('ERR', error.message); return; }
  console.log('Publicaciones sin mapear muestreadas:', (pubs || []).length, '\n');

  for (const p of pubs || []) {
    const sugerencias = [];

    // 1. Hermana mapeada
    const key = p.id_producto_catalogo || p.par_item_id;
    if (key) {
      const { data: her } = await s.from('publicaciones_externas')
        .select('mapeo_publicacion_articulo(articulo_id)')
        .eq('external_variation_id', '0')
        .or(`id_producto_catalogo.eq.${key},par_item_id.eq.${key}`)
        .neq('id', p.id).limit(10);
      const ids = new Set();
      for (const h of her || []) {
        const ms = Array.isArray(h.mapeo_publicacion_articulo) ? h.mapeo_publicacion_articulo : h.mapeo_publicacion_articulo ? [h.mapeo_publicacion_articulo] : [];
        ms.forEach((m) => m && m.articulo_id && ids.add(m.articulo_id));
      }
      if (ids.size) {
        const { data: arts } = await s.from('articulos').select('articulo_id, nombre, marca, modelo').in('articulo_id', [...ids]).limit(3);
        (arts || []).forEach((a) => sugerencias.push({ ...a, score: 98, metodo: 'hermana' }));
      }
    }

    // 2. SKU exacto
    const skus = [norm(p.seller_sku), norm(p.seller_custom_field)].filter(Boolean);
    if (skus.length) {
      const parts = skus.flatMap((x) => [`articulo_id.eq.${x}`, `modelo.eq.${x}`]);
      const { data } = await s.from('articulos').select('articulo_id, nombre, marca, modelo').or(parts.join(',')).limit(5);
      (data || []).forEach((a) => sugerencias.push({ ...a, score: 100, metodo: 'sku_exacto' }));
    }

    // 3. Código exacto
    const codes = [normCode(p.ean), normCode(p.gtin), normCode(p.upc)].filter(Boolean);
    if (codes.length) {
      const { data } = await s.from('articulos').select('articulo_id, nombre, marca, modelo, codigo_universal').in('codigo_universal', codes).limit(5);
      (data || []).forEach((a) => sugerencias.push({ ...a, score: 100, metodo: 'codigo_exacto' }));
    }

    // 4. Marca+modelo
    if (norm(p.model) && norm(p.brand)) {
      const { data } = await s.from('articulos').select('articulo_id, nombre, marca, modelo').eq('modelo', p.model).limit(20);
      (data || []).filter((a) => norm(a.marca) === norm(p.brand))
        .forEach((a) => sugerencias.push({ ...a, score: 95, metodo: 'marca_modelo' }));
    }

    // dedupe + ordenar
    const map = new Map();
    for (const x of sugerencias) { const prev = map.get(x.articulo_id); if (!prev || x.score > prev.score) map.set(x.articulo_id, x); }
    const top = [...map.values()].sort((a, b) => b.score - a.score).slice(0, 3);

    console.log(`MLM ${p.external_item_id} | sku=${p.seller_sku} | model=${p.model} | brand=${p.brand}`);
    console.log(`   titulo: ${(p.titulo || '').slice(0, 70)}`);
    if (top.length === 0) {
      console.log('   -> SIN sugerencia fuerte (requeriría fuzzy/búsqueda manual)');
    } else {
      for (const t of top) console.log(`   -> ${t.score}% [${t.metodo}] ${t.articulo_id} | ${t.nombre} | ${t.marca} ${t.modelo}`);
    }
    console.log('');
  }
})();
