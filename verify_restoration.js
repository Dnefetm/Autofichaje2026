const { createClient } = require('@supabase/supabase-js');
const u = 'https://ryxdqnzyvnrwalylqyvm.supabase.co';
const k = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5eGRxbnp5dm5yd2FseWxxeXZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODQ4NjcwNywiZXhwIjoyMDg0MDYyNzA3fQ.wlQUbd48z0jH0rx1_2bzL0sWkU1TaA-4rpX9DAmvflw';
const supabase = createClient(u, k);

async function run() {
  // 1. Fetch what v_proveedores_precios returns for Urrea
  console.log("=== v_proveedores_precios (lo que muestra el frontend) ===");
  const { data: vp, error: e1 } = await supabase
    .from('v_proveedores_precios')
    .select('*')
    .ilike('proveedor', '%urrea%');
  console.log(JSON.stringify(vp, null, 2));
  if (e1) console.error("Error:", e1);

  // 2. What does precios_proveedor_actual hold for Urrea?
  console.log("\n=== precios_proveedor_actual count ===");
  const { count: ppaCount, error: e2 } = await supabase
    .from('precios_proveedor_actual')
    .select('*', { count: 'exact', head: true })
    .ilike('proveedor', '%urrea%');
  console.log("Filas en precios_proveedor_actual para Urrea:", ppaCount);
  if (e2) console.error("Error:", e2);

  // 3. What does listas_precios_proveedor say is vigente?
  console.log("\n=== listas_precios_proveedor vigente ===");
  const { data: lpp, error: e3 } = await supabase
    .from('listas_precios_proveedor')
    .select('importacion_id, vigente, total_filas')
    .ilike('proveedor', '%urrea%')
    .eq('vigente', true);
  console.log(JSON.stringify(lpp, null, 2));
  if (e3) console.error("Error:", e3);

  // 4. What does v_lista_precios_proveedor return count for Urrea?
  console.log("\n=== v_lista_precios_proveedor count ===");
  const { count: vlpp, error: e4 } = await supabase
    .from('v_lista_precios_proveedor')
    .select('*', { count: 'exact', head: true })
    .ilike('proveedor', '%urrea%');
  console.log("Filas en v_lista_precios_proveedor para Urrea:", vlpp);
  if (e4) console.error("Error:", e4);

  // 5. Progreso-importacion page: where does it get its header count?
  // Search for the specific importacion page
  console.log("\n=== importaciones_excel recientes Urrea ===");
  const { data: imps, error: e5 } = await supabase
    .from('importaciones_excel')
    .select('id, estado, total_filas, filas_procesadas, proveedor, resumen_diff')
    .ilike('proveedor', '%urrea%')
    .order('creado_el', { ascending: false })
    .limit(5);
  if (imps) {
    for (const i of imps) {
      console.log(`\n  ID: ${i.id}`);
      console.log(`  Estado: ${i.estado}, total: ${i.total_filas}, procesadas: ${i.filas_procesadas}`);
      console.log(`  resumen_diff:`, JSON.stringify(i.resumen_diff));
    }
  }
  if (e5) console.error("Error:", e5);
}

run();
