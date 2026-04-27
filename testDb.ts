import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl!, supabaseKey!, { auth: { persistSession: false } });

async function run() {
    const id = 'fb8a73c8-f1fd-4bd9-9cc5-b8654e4f9d9b';
    const { count, error } = await supabase.from('costos_articulo').select('*', { count: 'exact', head: true }).eq('importacion_id', id);
    console.log("Count in costos_articulo:", count, error);

    const { count: countDecisiones, error: err2 } = await supabase.from('matching_decisiones').select('*', { count: 'exact', head: true }).eq('importacion_id', id);
    console.log("Count in matching_decisiones:", countDecisiones, err2);
}
run();
