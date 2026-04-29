import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    
    if (!supabaseUrl) {
        console.error('No supabase url found');
        return;
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Find the article ID for 660731152371
    const { data: arts } = await supabase
        .from('articulos')
        .select('articulo_id, codigo_universal')
        .eq('codigo_universal', '660731152371')
        .limit(1);
        
    if (!arts || arts.length === 0) {
        console.log('Article not found');
        return;
    }
    
    const artId = arts[0].articulo_id;
    console.log('Found Article ID:', artId);
    
    const { data: costos } = await supabase
        .from('costos_articulo')
        .select('*')
        .eq('articulo_id', artId);
        
    console.log('All Costos for article:');
    console.dir(costos, { depth: null });
}

run().catch(console.error);
