const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
    const { data, error } = await supabase.rpc('exec_sql', { sql: 'SELECT 1 as val' });
    console.log("exec_sql result:", data, error);
}
run();
