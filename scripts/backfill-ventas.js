// Backfill optimizado del histórico de 6 meses de ventas → ventas_diarias_ml.
// Lee un CSV (coma, fecha YYYY-MM-DD) con columnas: fecha, publicacion, codigo_ml, unidades.
// Resuelve codigo_ml vacío desde publicacion, y marketplace_id desde inventory_id (en lote).
// Agrupa/suma localmente por (marketplace_id, codigo_ml, fecha_dia) y hace carga en lote.
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const url = (env.match(/^SUPABASE_URL=(.+)$/m) || [])[1].trim();
const key = (env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m) || [])[1].trim();
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

const FILE = process.argv[2] || 'docs/ReposiciónFull/ventas-6meses.csv';

async function getAll(path) {
  const r = await fetch(`${url}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}

(async () => {
  const text = fs.readFileSync(FILE, 'utf8');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const obj = {};
    header.forEach((h, j) => { obj[h] = (cells[j] || '').trim(); });
    rows.push(obj);
  }
  console.log('filas leídas:', rows.length);

  // 1. Resolver codigo_ml vacío desde publicacion (en lote)
  const pubsEmpty = [...new Set(rows.filter(r => !r.codigo_ml && r.publicacion).map(r => r.publicacion))];
  const pubToInv = new Map();
  for (let i = 0; i < pubsEmpty.length; i += 300) {
    const chunk = pubsEmpty.slice(i, i + 300).map(p => `"${p}"`).join(',');
    const arr = await getAll(`publicaciones_externas?select=external_item_id,inventory_id&external_item_id=in.(${chunk})&inventory_id=not.is.null`);
    (arr || []).forEach(a => { if (!pubToInv.has(a.external_item_id)) pubToInv.set(a.external_item_id, a.inventory_id); });
  }
  console.log('publicaciones resueltas a código:', pubToInv.size);

  // 2. Construir filas con código + fecha + unidades (saltar inválidas)
  const parsed = [];
  for (const r of rows) {
    const fecha = (r.fecha || '').trim().slice(0, 10);
    const uni = parseInt(r.unidades, 10);
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Number.isFinite(uni)) continue;
    let codigo = (r.codigo_ml || '').trim();
    if (!codigo && r.publicacion) codigo = pubToInv.get(r.publicacion) || '';
    if (!codigo) continue;
    parsed.push({ codigo, fecha, uni });
  }
  console.log('filas con código válido:', parsed.length);

  // 3. Resolver marketplace_id desde inventory_id (en lote)
  const invs = [...new Set(parsed.map(r => r.codigo))];
  const invToMp = new Map();
  for (let i = 0; i < invs.length; i += 300) {
    const chunk = invs.slice(i, i + 300).map(c => `"${c}"`).join(',');
    const arr = await getAll(`publicaciones_externas?select=inventory_id,marketplace_id&inventory_id=in.(${chunk})&marketplace_id=not.is.null`);
    (arr || []).forEach(a => { if (!invToMp.has(a.inventory_id)) invToMp.set(a.inventory_id, a.marketplace_id); });
  }
  console.log('códigos con marketplace_id:', invToMp.size, 'de', invs.length);

  // 4. Agrupar + sumar localmente por (marketplace_id, codigo_ml, fecha_dia)
  const map = new Map();
  let sinCuenta = 0;
  for (const r of parsed) {
    const mp = invToMp.get(r.codigo);
    if (!mp) { sinCuenta++; continue; }
    const k = `${mp}|${r.codigo}|${r.fecha}`;
    map.set(k, (map.get(k) || 0) + r.uni);
  }
  const inserts = [...map.entries()].map(([k, uni]) => {
    const [mp, codigo, fecha] = k.split('|');
    return { marketplace_id: mp, codigo_ml: codigo, fecha_dia: fecha, unidades_vendidas: uni };
  });
  console.log('filas a insertar (agrupadas):', inserts.length, '| sin cuenta descartadas:', sinCuenta);

  // 5. Limpiar la tabla (evita doble conteo con el webhook previo)
  const del = await fetch(`${url}/rest/v1/ventas_diarias_ml?marketplace_id=not.is.null`, { method: 'DELETE', headers: H });
  console.log('limpieza previa:', del.ok ? 'ok' : `fail ${del.status}`);

  // 6. Carga en lote (1000 por request)
  let ok = 0, err = 0;
  for (let i = 0; i < inserts.length; i += 1000) {
    const batch = inserts.slice(i, i + 1000);
    const r = await fetch(`${url}/rest/v1/ventas_diarias_ml`, {
      method: 'POST',
      headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify(batch),
    });
    if (r.ok) ok += batch.length; else { err += batch.length; console.error('batch error en', i, await r.text().catch(() => '')); }
  }

  console.log(`FIN: insertadas=${ok} err=${err} sin_cuenta=${sinCuenta}`);
})().catch(e => { console.error(e); process.exit(1); });
