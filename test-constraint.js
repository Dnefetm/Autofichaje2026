require('dotenv').config({ path: 'apps/dashboard/.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

async function checkDB() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get constraints
    const { data: constraints, error } = await supabase.rpc('query_constraints', {});
    // Wait, typical supabase doesn't expose query_constraints. Let me try standard PG query via REST if available, 
    // but the easiest way is to try inserting a second row and see the error.

    const { error: insertError } = await supabase.from('marketplace_configs').insert({
        marketplace: 'mercadolibre',
        account_name: 'Cuenta Alternativa Test Constraint'
    });

    console.log("Insert Test Result:");
    if (insertError) {
        console.log(insertError);
    } else {
        console.log("Success! No strict UNIQUE(marketplace) constraint blocking it.");
        // clean up
        await supabase.from('marketplace_configs').delete().eq('account_name', 'Cuenta Alternativa Test Constraint');
    }
}
checkDB();
