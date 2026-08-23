// Verificación EN VIVO de solo lectura para auditar el blueprint (2026-08-23)
require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // 1) Estado real de la cola recalc_pricing_bundle (blueprint JSON dice failed=2136 al 2026-08-15)
  for (const st of ['failed', 'pending', 'processing', 'completed']) {
    const { count, error } = await supabase.from('jobs').select('*', { count: 'exact', head: true })
      .eq('type', 'recalc_pricing_bundle').eq('status', st);
    console.log(`jobs/recalc_pricing_bundle/${st}:`, error ? 'ERR ' + error.message : count);
  }
  // 2) Existencia real de tablas que el código referencia (42P01 = no existe)
  const tablas = ['proveedor_configs', 'importaciones_precios', 'precio_import_batches', 'bundle_components', 'precios_historial_proveedor', 'costos_articulo'];
  for (const t of tablas) {
    const { error } = await supabase.from(t).select('*', { head: true, count: 'exact' }).limit(0);
    console.log(`tabla ${t}:`, error ? `NO EXISTE (${error.code || error.message})` : 'EXISTE');
  }
  // 3) Costos vigentes (bloqueante conocido del pipeline de precios)
  const { count: vig, error: eVig } = await supabase.from('costos_articulo').select('*', { count: 'exact', head: true }).eq('vigente', true);
  console.log('costos_articulo vigentes:', eVig ? 'ERR ' + eVig.message : vig);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
