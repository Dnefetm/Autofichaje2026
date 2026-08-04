const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { count } = await supabase.from('jobs').select('*', { count: 'exact', head: true }).ilike('error_log', '%rate%');
  const { count: count429 } = await supabase.from('jobs').select('*', { count: 'exact', head: true }).ilike('error_log', '%429%');
  const { count: countTooMany } = await supabase.from('jobs').select('*', { count: 'exact', head: true }).ilike('error_log', '%too many%');
  console.log('Rate limit counts:', { rate: count, '429': count429, tooMany: countTooMany });
}

check();
