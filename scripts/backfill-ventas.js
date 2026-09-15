// Backfill del histórico de 6 meses de ventas → ventas_diarias_ml.
// Lee un CSV con columnas: fecha, publicacion (opcional), codigo_ml (opcional), unidades.
// Mapea publicacion → codigo_ml vía publicaciones_externas cuando falta el código.
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const url = (env.match(/^SUPABASE_URL=(.+)$/m) || [])[1].trim();
const key = (env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m) || [])[1].trim();
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

const FILE = process.argv[2] || 'docs/ReposiciónFull/ventas-6meses.csv';

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const obj = {};
    header.forEach((h, j) => { obj[h] = (cells[j] || '').trim(); });
    rows.push(obj);
  }
  return rows;
}

(async () => {
  const text = fs.readFileSync(FILE, 'utf8');
  const rows = parseCSV(text);
  console.log('filas leídas:', rows.length);

  // cache publicacion → codigo_ml
  const cache = new Map();
  let ok = 0, err = 0, sinCodigo = 0;

  for (const r of rows) {
    let codigo = (r.codigo_ml || '').trim();
    const pub = (r.publicacion || '').trim();
    const fecha = (r.fecha || '').trim().slice(0, 10);
    const uni = parseInt(r.unidades, 10);
    if (!fecha || !Number.isFinite(uni)) { err++; continue; }

    // resolver codigo_ml desde publicacion si falta
    if (!codigo && pub) {
      if (cache.has(pub)) {
        codigo = cache.get(pub);
      } else {
        const q = await fetch(`${url}/rest/v1/publicaciones_externas?select=inventory_id&external_item_id=eq.${pub}&external_variation_id=eq.0&inventory_id=not.is.null&limit=1`, { headers: H });
        const arr = await q.json();
        codigo = arr[0]?.inventory_id || '';
        cache.set(pub, codigo);
      }
    }
    if (!codigo) { sinCodigo++; continue; }

    const body = { p_marketplace_id: null, p_codigo_ml: codigo, p_fecha_dia: fecha, p_unidades: uni };
    // marketplace_id: intentar resolver; si no, usar la cuenta Full (Mejorísimo)
    // Resolver marketplace desde publicaciones_externas por inventory_id
    const mq = await fetch(`${url}/rest/v1/publicaciones_externas?select=marketplace_id&inventory_id=eq.${codigo}&limit=1`, { headers: H });
    const marr = await mq.json();
    body.p_marketplace_id = marr[0]?.marketplace_id || null;

    const up = await fetch(`${url}/rest/v1/rpc/upsert_venta_diaria_ml`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    if (up.ok) ok++; else err++;
  }

  console.log(`FIN: ok=${ok} err=${err} sin_codigo_ml=${sinCodigo}`);
})().catch(e => { console.error(e); process.exit(1); });
