const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Manual env parsing for simplicity
const envPath = path.resolve('apps/dashboard/.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) env[key.trim()] = value.trim();
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    console.log('--- DB CHECK ---');
    const { data: configs } = await supabase.from('marketplace_configs').select('id, account_name, settings');
    const { data: tokens } = await supabase.from('marketplace_tokens').select('marketplace_id');

    console.log('CONFIGS_COUNT:', configs?.length || 0);
    if (configs) configs.forEach(c => console.log(`Config found: ${c.account_name} (${c.id}) - CID: ${c.settings?.client_id}`));

    console.log('TOKENS_COUNT:', tokens?.length || 0);
    if (tokens) tokens.forEach(t => console.log(`Token found for ID: ${t.marketplace_id}`));
}

check().catch(console.error);
