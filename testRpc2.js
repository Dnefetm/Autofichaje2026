const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

async function run() {
    const id = 'fb8a73c8-f1fd-4bd9-9cc5-b8654e4f9d9b';
    const { data: rpcStats, error } = await supabase.rpc('fn_resumen_matching', { p_importacion_id: id });
    console.log("RPC result:", rpcStats, error);
}

run();
