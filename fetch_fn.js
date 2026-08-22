
require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
    const { data } = await supabase.rpc('exec_sql', { sql: 'SELECT pg_get_functiondef(oid) as src FROM pg_proc WHERE proname = \'fn_recalcular_precio_publicacion\'' });
    require('fs').writeFileSync('fn.sql', data[0].src);
})();

