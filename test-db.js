require('dotenv').config({ path: 'apps/dashboard/.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    const { data, error } = await supabase.from('ubicaciones').select('*').limit(1);
    console.log('ubicaciones error:', error);
}
check();
