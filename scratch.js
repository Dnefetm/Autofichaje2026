const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.from('importaciones_excel').select('id, estado').order('creado_el', { ascending: false }).limit(1);
  if (error) {
      console.error("DB Error:", error);
      return;
  }
  const id = data[0].id;
  console.log("Testing with ID:", id, data[0].estado);
  const res = await fetch(`http://localhost:3000/api/precios/importar/${id}/costos`);
  const text = await res.text();
  console.log("STATUS:", res.status);
  try {
      console.log("JSON PARSED SUCCESSFULLY:", JSON.parse(text) ? "YES" : "NO");
  } catch(e) {
      console.log("JSON ERROR! BODY:", text.substring(0, 500));
  }
}

run();
