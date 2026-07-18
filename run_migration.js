const fs = require('fs');
require('dotenv').config({ path: 'apps/dashboard/.env.local' });

const url = 'https://ryxdqnzyvnrwalylqyvm.supabase.co/rest/v1/rpc/exec_sql';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const sql = fs.readFileSync('supabase/migrations/20260427000000_v80_pricing_engine_meli.sql', 'utf8');

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
