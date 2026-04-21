import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("=== SQL AUDIT: importaciones_excel URREA ===");
  const { data, error } = await supabase
    .from('importaciones_excel')
    .select('id, proveedor, estado, creado_el, nombre_archivo, mapeo_columnas')
    .ilike('proveedor', '%Urrea%')
    .order('creado_el', { ascending: false })
    .limit(3);
    
  if (error) console.error("Error:", error);
  else console.log(JSON.stringify(data, null, 2));

  console.log("\n=== SQL AUDIT: TODOS LOS ESTADOS RECIENTES ===");
  const { data: d2 } = await supabase
    .from('importaciones_excel')
    .select('proveedor, estado, creado_el')
    .order('creado_el', { ascending: false })
    .limit(5);
  console.log(JSON.stringify(d2, null, 2));
}

run();
