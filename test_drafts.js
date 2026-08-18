const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const fs = require('fs');

const envs = dotenv.parse(fs.readFileSync('apps/dashboard/.env.local'));
const supabase = createClient(envs.NEXT_PUBLIC_SUPABASE_URL, envs.SUPABASE_SERVICE_ROLE_KEY);

async function checkFunction() {
  const { data: mapeo } = await supabase.from('mapeo_publicacion_articulo').select('publicacion_id').limit(1);
  const pubId = mapeo[0].publicacion_id;
  
  // Borramos el draft si existiera
  await supabase.from('publication_pricing_drafts').delete().eq('publicacion_id', pubId);

  // Ejecutamos el recalculo
  const { error: rpcErr } = await supabase.rpc('fn_recalcular_precio_publicacion', { p_publicacion_id: pubId });
  console.log('RPC execution error:', rpcErr);

  // Revisamos si se generó un draft
  const { data: draft } = await supabase.from('publication_pricing_drafts').select('*').eq('publicacion_id', pubId);
  console.log('Draft generated:', draft.length > 0 ? 'YES' : 'NO');
}
checkFunction();
