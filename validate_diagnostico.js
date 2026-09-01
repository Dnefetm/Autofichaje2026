// Valida las afirmaciones del diagnóstico contra la BD de producción (solo lectura).
// Credenciales: se leen de .env (gitignored), nunca hardcodeadas.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Falta NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env');
  process.exit(1);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

async function count(table, filterFn) {
  let q = supabase.from(table).select('*', { count: 'exact', head: true });
  if (filterFn) q = filterFn(q);
  const { count, error } = await q;
  if (error) return { error: error.message };
  return { count };
}

async function main() {
  const out = {};

  // 1. fichas_tecnicas
  out.fichas_total = await count('fichas_tecnicas');
  out.fichas_con_articulo = await count('fichas_tecnicas', (q) => q.not('articulo_id', 'is', null));
  out.fichas_con_publicacion = await count('fichas_tecnicas', (q) => q.not('publicacion_externa_id', 'is', null));

  // 2. publicaciones_externas
  out.pubs_total = await count('publicaciones_externas');
  out.pubs_con_padre = await count('publicaciones_externas', (q) => q.not('id_publicacion_padre', 'is', null));

  // tipo_publicacion breakdown
  const { data: tipos, error: tiposErr } = await supabase.from('publicaciones_externas').select('tipo_publicacion');
  if (tiposErr) { out.tipos_error = tiposErr.message; } else {
    const map = {};
    for (const r of tipos) { const k = r.tipo_publicacion || '(null)'; map[k] = (map[k] || 0) + 1; }
    out.tipos = map;
    out.tipos_total_rows = tipos.length;
  }

  // catálogo con padre
  out.catalogo_con_padre = await count('publicaciones_externas', (q) =>
    q.eq('tipo_publicacion', 'catalogo').not('id_publicacion_padre', 'is', null));

  // 3. mapeo_publicacion_articulo
  out.mapeo_total = await count('mapeo_publicacion_articulo');
  out.mapeo_cantidad_gt1 = await count('mapeo_publicacion_articulo', (q) => q.gt('cantidad_requerida', 1));

  // publicaciones con múltiples artículos
  const { data: mapeo, error: mapeoErr } = await supabase.from('mapeo_publicacion_articulo').select('publicacion_id, articulo_id, cantidad_requerida');
  if (mapeoErr) {
    out.mapeo_error = mapeoErr.message;
  } else {
    out.mapeo_rows = mapeo.length;
    const pubToArts = {};
    const artToPubs = {};
    for (const r of mapeo) {
      pubToArts[r.publicacion_id] = pubToArts[r.publicacion_id] || new Set();
      pubToArts[r.publicacion_id].add(r.articulo_id);
      artToPubs[r.articulo_id] = artToPubs[r.articulo_id] || new Set();
      artToPubs[r.articulo_id].add(r.publicacion_id);
    }
    out.pubs_multi_articulo = Object.values(pubToArts).filter((s) => s.size > 1).length;
    out.articulos_multi_pub = Object.values(artToPubs).filter((s) => s.size > 1).length;
  }

  // 4. publication_pricing_overrides
  out.overrides_total = await count('publication_pricing_overrides');

  // 5. total articulos (catálogo maestro)
  out.articulos_total = await count('articulos');

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
