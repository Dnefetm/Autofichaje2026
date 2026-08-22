
require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
    const { data } = await supabase.rpc('exec_sql', { sql: 'SELECT pg_get_functiondef(oid) as src FROM pg_proc WHERE proname = \'fn_recalcular_precio_publicacion\'' });
    if (data && data[0]) {
        require('fs').writeFileSync('C:/Users/dnefe/.gemini/antigravity/brain/e5e73cd2-3401-489a-9f83-d20d8d924e52/scratch/fn.sql', data[0].src);
        console.log('Saved to fn.sql');
    } else {
        console.log('Function not found or exec_sql failed');
    }
})();

