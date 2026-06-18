require('dotenv').config({ path: 'apps/dashboard/.env.local' });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data: res1, error: err1 } = await sb.rpc('exec_sql', { query: `SELECT pg_get_functiondef('public.fn_resolver_y_poblar_costos'::regproc);` });
    if (err1) {
        console.log("exec_sql failed, trying direct select via REST if possible... wait, RPC exec_sql might not exist. Error:", err1.message);
    } else {
        console.log("fn_resolver:\n", res1);
    }
}
run();
