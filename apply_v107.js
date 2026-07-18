const fs = require('fs');

const url = 'https://ryxdqnzyvnrwalylqyvm.supabase.co/rest/v1/rpc/exec_sql';
require('dotenv').config({ path: 'apps/dashboard/.env.local' }); const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const sql = fs.readFileSync('supabase/migrations/20260512000000_v107_fix_hub_precios.sql', 'utf8');

fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': 'Bearer ' + key,
  },
  body: JSON.stringify({ sql_query: sql })
})
.then(async r => {
   const text = await r.text();
   console.log('Status:', r.status);
   console.log('Response:', text);
})
.catch(e => console.error('Error:', e.message));
