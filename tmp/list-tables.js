const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.resolve('apps/dashboard/.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) env[key.trim()] = value.trim();
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function listTables() {
    console.log('--- TABLE LIST ---');
    const { data, error } = await supabase.rpc('get_tables'); // Or query information_schema

    // Fallback if RPC doesn't exist
    const { data: infoSchema, error: err2 } = await supabase.from('skus').select('count', { count: 'exact', head: true });

    // Let's try to query information_schema directly via raw SQL if possible, but JS client is limited.
    // We'll just try to "guess" by checking common tables.
    const tables = ['marketplace_configs', 'marketplaces', 'marketplace_tokens', 'tokens', 'skus', 'productos'];
    for (const t of tables) {
        const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
        console.log(`Table '${t}': ${error ? 'NOT_FOUND' : count + ' rows'}`);
    }
}

listTables().catch(console.error);
