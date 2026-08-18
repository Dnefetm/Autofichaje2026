const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const fs = require('fs');

const envs = dotenv.parse(fs.readFileSync('apps/dashboard/.env.local'));
const supabase = createClient(envs.NEXT_PUBLIC_SUPABASE_URL, envs.SUPABASE_SERVICE_ROLE_KEY);

async function checkCounts() {
  const tables = [
    'jobs',
    'publication_pricing_history',
    'publication_pricing_drafts',
    'publicaciones_externas',
    'costos_articulo',
    'mapeo_publicacion_articulo'
  ];

  console.log('--- Row Counts ---');
  for (const table of tables) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      console.log(table + ': Error - ' + error.message);
    } else {
      console.log(table + ': ' + count + ' rows');
    }
  }
}

checkCounts();
