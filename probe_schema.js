const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  // Query matching_decisiones schema
  const { data: colsDecisiones, error: err1 } = await supabase.rpc('query_schema', { table_name: 'matching_decisiones' })
    .catch(async () => {
      // Fallback if rpc is not available
      return await supabase.from('matching_decisiones').select('*').limit(1);
    });

  console.log("matching_decisiones probe:", colsDecisiones || err1);

  const { data: colsVista, error: err2 } = await supabase.from('v_matching_candidatos').select('*').limit(1);
  console.log("v_matching_candidatos probe:", colsVista || err2);
}

main();
