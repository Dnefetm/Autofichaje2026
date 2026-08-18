const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const fs = require('fs');

const envs = dotenv.parse(fs.readFileSync('apps/dashboard/.env.local'));
const supabase = createClient(envs.NEXT_PUBLIC_SUPABASE_URL, envs.SUPABASE_SERVICE_ROLE_KEY);

async function checkFunction() {
  const { data: pub } = await supabase.from('publicaciones_externas').select('id').limit(1);
  const pubId = pub[0].id;
  console.log('Testing with pubId:', pubId);
  
  await supabase.rpc('fn_recalcular_precio_publicacion', { p_publicacion_id: pubId });

  const { data: draft } = await supabase.from('publication_pricing_drafts').select('*').eq('publicacion_id', pubId);
  console.log('Draft:', draft);
}
checkFunction();
