const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './apps/dashboard/.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  console.log("Fetching importacion...");
  const { data: imp, error } = await supabase
    .from('importaciones_excel')
    .select('*')
    .eq('estado', 'en_revision')
    .limit(1)
    .single();
    
  if (error || !imp) {
     console.error("No import found in en_revision state", error);
     return;
  }
  
  console.log("Found import:", imp.id, imp.proveedor);
  console.log("Running fn_consolidar_revision_importacion...");
  
  const { data, error: rpcErr } = await supabase.rpc('fn_consolidar_revision_importacion', {
     p_importacion_id: imp.id,
     p_proveedor: imp.proveedor
  });
  
  if (rpcErr) {
      console.error("RPC FAILED:", rpcErr);
  } else {
      console.log("RPC SUCCESS!");
  }
}

run();
