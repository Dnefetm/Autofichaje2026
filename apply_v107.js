const fs = require('fs');

const url = 'https://ryxdqnzyvnrwalylqyvm.supabase.co/rest/v1/rpc/exec_sql';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5eGRxbnp5dm5yd2FseWxxeXZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODQ4NjcwNywiZXhwIjoyMDg0MDYyNzA3fQ.wlQUbd48z0jH0rx1_2bzL0sWkU1TaA-4rpX9DAmvflw';

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
