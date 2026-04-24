require('dotenv').config(); 
const { createClient } = require('@supabase/supabase-js'); 
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); 
async function run() { 
  const { data, error } = await sb.from('importaciones_excel').select('id').limit(1); 
  if(data && data.length) { 
    const res = await sb.from('importaciones_excel').delete().eq('id', data[0].id); 
    console.log("Delete error:", res.error); 
  } else {
    console.log("No importaciones found", error);
  }
} 
run();
