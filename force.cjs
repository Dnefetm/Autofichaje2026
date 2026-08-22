
require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
    // Find publicacion associated with L22L382
    const { data: mapData } = await supabase.from('mapeo_publicacion_articulo').select('publicacion_id').eq('articulo_id', 'L22L382').limit(1);
    const pubId = mapData && mapData[0] ? mapData[0].publicacion_id : null;
    if (pubId) {
        const { data } = await supabase.from('publicaciones_externas').select('precio_publicado').eq('id', pubId);
        if (data && data[0]) {
            console.log('Current L22L382 price:', data[0].precio_publicado);
            await supabase.from('publicaciones_externas')
                .update({ 
                    draft_price: (data[0].precio_publicado || 100) * 1.15,
                    draft_status: 'valid'
                })
                .eq('id', pubId);
            console.log('Forced draft_price for testing on', pubId);
        }
    }
})();

