require('dotenv').config({ path: 'apps/dashboard/.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

async function checkJobs() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: jobs, error } = await supabase
        .from('jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

    let result = '';
    if (error) {
        result = 'ERROR:\n' + JSON.stringify(error, null, 2);
    } else {
        result = 'JOBS:\n' + JSON.stringify(jobs, null, 2);
    }
    fs.writeFileSync('out.txt', result);
    console.log("Done");
}
checkJobs();
