import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    
    if (!supabaseUrl) {
        console.error('No supabase url found');
        return;
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log('Querying costos_articulo...');
    const { data: costos, error } = await supabase
        .from('costos_articulo')
        .select('*')
        .limit(10)
        .order('creado_el', { ascending: false });
        
    console.log('Error:', error);
    console.log('Costos count:', costos?.length);
    if (costos && costos.length > 0) {
        console.log('Sample costo:', costos[0]);
    }
    
    const { count: countVigente } = await supabase
        .from('costos_articulo')
        .select('*', { count: 'exact', head: true })
        .eq('vigente', true);
        
    console.log('Total costos vigentes:', countVigente);
}

run().catch(console.error);
