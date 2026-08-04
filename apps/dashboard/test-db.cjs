const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'apps/dashboard/.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function test() {
    const { data: d, error } = await supabase.from('fichas_tecnicas')
      .select('nombre_producto, descripcion, descripcion_larga, especificaciones')
      .ilike('nombre_producto', '%Cinta Adhesiva Delimitadora%')
      .limit(1);
    console.log(d, error);
}
test();
