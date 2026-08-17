const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkErrors() {
    console.log("Fetching recent failed imports...");
    const { data, error } = await supabase
        .from('importaciones_excel')
        .select('id, proveedor, estado, error_log, ultima_actividad, creado_el')
        .order('creado_el', { ascending: false })
        .limit(5);

    if (error) {
        console.error("DB Error:", error);
        return;
    }

    console.log(JSON.stringify(data, null, 2));
}

checkErrors();
