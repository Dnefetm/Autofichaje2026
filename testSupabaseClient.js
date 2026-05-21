const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envLocal = fs.readFileSync('apps/dashboard/.env.local', 'utf8');
const url = envLocal.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1];
const key = envLocal.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1];

const supa = createClient(url, key);

async function run() {
    const { data, error, count } = await supa.from('v_lista_precios_proveedor')
        .select('*', { count: 'exact' })
        .eq('proveedor', 'Urrea Herramientas')
        .limit(10);
    
    console.log("Count:", count);
    if(error) console.log("Error:", error);
    else console.log("Data length:", data.length);
}
run();
