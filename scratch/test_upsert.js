const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'apps/dashboard/.env.local' });
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Use a different approach to find unique constraints, inserting a duplicate to see the error detail
  const { error } = await s.from('proveedor_articulos_alias').upsert([
    { proveedor: 'Urrea Herramientas', codigo_excel: '123', articulo_id: 'abc' }
  ], { onConflict: 'proveedor,codigo_excel' });
  console.log('Error:', error);
}
run();
