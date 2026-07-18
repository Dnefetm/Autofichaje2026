const fs = require('fs');

async function check() {
    const url = 'https://ryxdqnzyvnrwalylqyvm.supabase.co/rest/v1/rpc/exec_sql';
      require('dotenv').config({ path: 'apps/dashboard/.env.local' }); const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const sql = 'SELECT * FROM marketplace_prices LIMIT 5;';
    
    try {
        const r = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': key,
                'Authorization': 'Bearer ' + key,
            },
            body: JSON.stringify({ sql_query: sql })
        });
        const t = await r.text();
        console.log("SQL Result:", t);
    } catch(e) {
        console.error("Error:", e);
    }
}
check();
