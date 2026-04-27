import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '../../apps/dashboard/.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false }
});

async function run() {
    const id = 'fb8a73c8-f1fd-4bd9-9cc5-b8654e4f9d9b';
    console.log('Borrando decisiones anteriores...');
    await supabase.from('matching_decisiones').delete().eq('importacion_id', id);
    await supabase.from('costos_articulo').delete().eq('importacion_id', id);
    
    console.log('Llamando fn_match_precios_v2... esto puede tardar...');
    const { data, error } = await supabase.rpc('fn_match_precios_v2', { p_importacion_id: id });
    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Éxito! fn_match_precios_v2 completado.');
        
        console.log('Validando count...');
        const { count: raws } = await supabase.from('listas_precios_raw').select('*', { count: 'exact', head: true }).eq('importacion_id', id);
        const { count: decs } = await supabase.from('matching_decisiones').select('*', { count: 'exact', head: true }).eq('importacion_id', id);
        const { count: n4 } = await supabase.from('matching_decisiones').select('*', { count: 'exact', head: true }).eq('importacion_id', id).eq('nivel', 4);
        console.log(`Raws: ${raws}, Decisiones: ${decs}, Nivel 4 (Sin Match): ${n4}`);
    }
}

run();
