const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'apps/dashboard/.env.local' });
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const IMP_ID = 'b3b4661a-2218-4264-a4f9-ef5d94a670ca';
  
  // 1. Raw rows
  let allRaw = [];
  let from = 0;
  while (true) {
    const { data } = await s.from('listas_precios_raw').select('fila_num, payload').eq('importacion_id', IMP_ID).range(from, from+999);
    if (!data || data.length === 0) break;
    allRaw = allRaw.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  
  // 2. All active articulos
  let allArts = [];
  from = 0;
  while(true) {
    const { data } = await s.from('articulos').select('articulo_id, nombre, modelo, marca, codigo_universal, sku').eq('activo', true).range(from, from+999);
    if (!data || data.length===0) break;
    allArts = allArts.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  
  console.log('Filas raw:', allRaw.length);
  console.log('Articulos activos:', allArts.length);
  
  // 3. Match
  const byCode = new Map();
  const byModel = new Map();
  for (const a of allArts) {
    if (a.codigo_universal) {
        if (!byCode.has(a.codigo_universal)) byCode.set(a.codigo_universal, a);
    }
    if (a.modelo) {
        const marca = (a.marca||'').toLowerCase();
        const modelo = a.modelo.toLowerCase();
        byModel.set(`${marca}|||${modelo}`, a);
        byModel.set(`|||${modelo}`, a);
    }
  }
  
  let cat_triple = 0, cat_solo_codigo = 0, cat_marca_modelo = 0, sin_match = 0;
  
  for (const r of allRaw) {
    const p = r.payload || {};
    const clave = (p['CLAVE'] || p['CÓDIGO'] || '').toLowerCase();
    const codigo_barra = p['CÓDIGO DE BARRA SIN CERO'] || '';
    const marca = (p['MARCA'] || '').toLowerCase();
    
    let matched = false;
    
    if (codigo_barra && byCode.has(codigo_barra)) {
        const art = byCode.get(codigo_barra);
        const marcaMatch = (art.marca||'').toLowerCase() === marca;
        const modeloMatch = (art.modelo||'').toLowerCase() === clave;
        if (marcaMatch && modeloMatch) cat_triple++;
        else cat_solo_codigo++;
        matched = true;
    } else if (clave && (byModel.has(`${marca}|||${clave}`) || byModel.has(`|||${clave}`))) {
        cat_marca_modelo++;
        matched = true;
    }
    
    if (!matched) sin_match++;
  }
  
  console.log('Triple:', cat_triple);
  console.log('Solo codigo:', cat_solo_codigo);
  console.log('Solo modelo:', cat_marca_modelo);
  console.log('Sin match:', sin_match);
  console.log('Total sum:', cat_triple + cat_solo_codigo + cat_marca_modelo + sin_match);
}
test();
