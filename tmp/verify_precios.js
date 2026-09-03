// Verificación y snapshot SOLO-LECTURA del módulo de precios.
// Uso:
//   node tmp/verify_precios.js [--snapshot]
//   - Sin flags: imprime estado actual + assert de que fn_vincular_lote ya no
//     lanza 22P02 (debería lanzar 23503 por FK con articulo_id inexistente).
//   - --snapshot: guarda counts en tmp/snapshot_precios.json para comparar antes/después.
// NO modifica datos: la prueba del RPC usa articulo_id inexistente, por lo que
// (con el fix aplicado) falla por FK sin escribir nada.
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const p = path.resolve(__dirname, '..', file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = (m[2] || '').replace(/^["']|["']$/g, '');
  }
}
loadEnv('.env');

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PROVIDER = 'Urrea Herramientas';

async function cnt(q) { const r = await q; return { count: r.count, error: r.error?.message || null }; }

async function main() {
  const out = { at: new Date().toISOString(), proveedor: PROVIDER };

  // Snapshot de counts
  out.importaciones = await cnt(supabase.from('importaciones_excel').select('id', { count: 'exact', head: true }).eq('proveedor', PROVIDER));
  out.aliases = await cnt(supabase.from('proveedor_articulos_alias').select('id', { count: 'exact', head: true }).eq('proveedor', PROVIDER));
  out.aliases_locked = await cnt(supabase.from('proveedor_articulos_alias').select('id', { count: 'exact', head: true }).eq('proveedor', PROVIDER).eq('locked', true));

  // Último lote del proveedor
  const imp = await supabase.from('importaciones_excel').select('id, estado, total_filas, creado_el').eq('proveedor', PROVIDER).order('creado_el', { ascending: false }).limit(1);
  const lotId = imp.data?.[0]?.id || null;
  out.ultimo_lote = { error: imp.error?.message || null, data: imp.data || [] };

  if (lotId) {
    out.costos_articulo = await cnt(supabase.from('costos_articulo').select('id', { count: 'exact', head: true }).eq('importacion_id', lotId));
    out.costos_pendientes = await cnt(supabase.from('costos_pendientes').select('id', { count: 'exact', head: true }).eq('importacion_id', lotId));
    out.costos_pendientes_no_resueltos = await cnt(supabase.from('costos_pendientes').select('id', { count: 'exact', head: true }).eq('importacion_id', lotId).eq('resuelto', false));
  }

  // Assert no destructivo del fix: articulo_id inexistente.
  //  - 22P02 => el cast UUID sigue (fix NO aplicado).
  //  - 23503 (FK) u otro => el cast pasó (fix aplicado). Nunca escribe.
  const rpc = await supabase.rpc('fn_vincular_lote', {
    p_proveedor: '__probe_verify__',
    p_items: [{ articulo_id: 'zzz-not-a-uuid', codigo_excel: '__PROBE_DO_NOT_WRITE__', modelo_excel: '__PROBE__', marca_excel: '__PROBE__' }]
  });
  out.assert_fn_vincular_lote = {
    error_code: rpc.error?.code || null,
    error_message: rpc.error?.message || null,
    conclusion: rpc.error?.code === '22P02'
      ? 'FIX NO APLICADO (sigue el cast UUID)'
      : 'FIX APLICADO (el cast ya no lanza 22P02)'
  };

  // Confirmar que la prueba no dejó residuos
  const residuo = await cnt(supabase.from('proveedor_articulos_alias').select('id', { count: 'exact', head: true }).eq('proveedor', '__probe_verify__'));
  out.residuo = residuo;

  console.log(JSON.stringify(out, null, 2));

  if (process.argv.includes('--snapshot')) {
    fs.writeFileSync(path.resolve(__dirname, 'snapshot_precios.json'), JSON.stringify(out, null, 2));
    console.log('\n[snapshot guardado en tmp/snapshot_precios.json]');
  }
}

main().catch((e) => { console.log('ERR', e && e.stack || e); });
