import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

async function run() {
    await supabaseAdmin.from('webhook_config').upsert({ topic: 'items', window_seconds: 600, enabled: true }, { onConflict: 'topic' });
    await supabaseAdmin.from('webhook_config').upsert({ topic: 'questions', window_seconds: 900, enabled: true }, { onConflict: 'topic' });
    console.log("Updated DB webhook_config");
}
run();
