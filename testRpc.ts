import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.example' }); // using .env.example if it has the keys or maybe .env?

console.log("Loading keys...");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing supabase URL or Key");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
});

async function run() {
    const id = 'fb8a73c8-f1fd-4bd9-9cc5-b8654e4f9d9b';
    const { data: rpcStats, error } = await supabase.rpc('fn_resumen_matching', { p_importacion_id: id });
    console.log("RPC result:", rpcStats, error);
}

run();
